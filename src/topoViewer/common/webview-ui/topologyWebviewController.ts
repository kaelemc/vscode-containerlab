// file: topologyWebviewController.ts

import type cytoscape from 'cytoscape';
import { createConfiguredCytoscape } from '../cytoscapeInstanceFactory';

// Import Tailwind CSS and Font Awesome
import './tailwind.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
// Import Leaflet CSS for map tiles
import 'leaflet/dist/leaflet.css';
// Import cytoscape-leaflet CSS for geo-positioning
import '../../view/webview-ui/cytoscape-leaflet.css';

import loadCytoStyle from './managerCytoscapeBaseStyles';
import { VscodeMessageSender } from './managerVscodeWebview';
import { fetchAndLoadData, fetchAndLoadDataEnvironment } from '../../edit/webview-ui/managerCytoscapeFetchAndLoad';
import { ManagerSaveTopo } from '../../edit/webview-ui/managerSaveTopo';
import { ManagerUndo } from '../../edit/webview-ui/managerUndo';
import { ManagerAddContainerlabNode } from '../../edit/webview-ui/managerAddContainerlabNode';
import { ManagerViewportPanels } from '../../edit/webview-ui/managerViewportPanels';
import { ManagerFloatingActionPanel } from '../../edit/webview-ui/managerFloatingActionPanel';
import { ManagerFreeText } from '../../edit/webview-ui/managerFreeText';
import { exportViewportAsSvg } from './utils';
import type { ManagerGroupManagement } from './managerGroupManagement';
import type { ManagerLayoutAlgo } from './managerLayoutAlgo';
import type { ManagerZoomToFit } from './managerZoomToFit';
import type { ManagerLabelEndpoint } from '../../edit/webview-ui/managerLabelEndpoint';
import type { ManagerReloadTopo } from '../../edit/webview-ui/managerReloadTopo';
import { layoutAlgoManager as layoutAlgoManagerSingleton, getGroupManager, zoomToFitManager as zoomToFitManagerSingleton, labelEndpointManager as labelEndpointManagerSingleton, getReloadTopoManager } from '../core/managerRegistry';
import { log } from '../logging/webviewLogger';
import { registerCyEventHandlers } from './cyEventHandlers';
import topoViewerState from '../state';
import type { EdgeData } from '../types/topoViewerGraph';




/**
 * TopologyWebviewController is responsible for initializing the Cytoscape instance,
 * managing edge creation, node editing and viewport panels/buttons.
 * Entry point for the topology editor webview; methods are called from vscodeHtmlTemplate.ts.
 */
class TopologyWebviewController {
  public cy: cytoscape.Core;
  private cyEvent: cytoscape.EventObject | undefined;
  private eh: any;
  private isEdgeHandlerActive: boolean = false;
  private isViewportDrawerClabEditorChecked: boolean = true; // Editor mode flag
  private isEditingLocked: boolean = false; // Flag to track if editing is locked due to deployment

  public messageSender: VscodeMessageSender;
  public saveManager: ManagerSaveTopo;
  public undoManager: ManagerUndo;
  public addNodeManager: ManagerAddContainerlabNode;
  public viewportPanels?: ManagerViewportPanels;
  public floatingActionPanel: ManagerFloatingActionPanel | null = null;
  public groupManager: ManagerGroupManagement;
  /** Layout manager instance accessible by other components */
  public layoutAlgoManager: ManagerLayoutAlgo;
  public zoomToFitManager: ManagerZoomToFit;
  public labelEndpointManager: ManagerLabelEndpoint;
  public reloadTopoManager: ManagerReloadTopo;
  public freeTextManager?: ManagerFreeText;
  // eslint-disable-next-line no-unused-vars
  public captureViewportManager: { viewportButtonsCaptureViewportAsSvg: (cy: cytoscape.Core) => void };
  private interfaceCounters: Record<string, number> = {};



  private debounce(func: Function, wait: number) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  /**
   * Check if editing is locked due to deployment state
   */
  private checkDeploymentState(): void {
    const isLabDeployed = (window as any).isLabDeployed;
    this.isEditingLocked = isLabDeployed === true;
    log.info(`Deployment state check: isLabDeployed=${isLabDeployed}, editing locked: ${this.isEditingLocked}`);
  }

  /**
   * Checks if editing operations should be blocked
   */
  private isEditingBlocked(): boolean {
    if (this.isEditingLocked) {
      log.warn('Editing operation blocked - lab is deployed');
      return true;
    }
    return false;
  }

  /**
   * Apply editing restrictions when lab is deployed
   */
  private applyEditingRestrictions(): void {
    if (!this.isEditingLocked) {
      return;
    }

    log.info('Applying editing restrictions - lab is deployed');

    // Disable node dragging
    this.cy.nodes().ungrabify();
    
    // Disable edge creation if edgehandles is active
    if (this.eh && this.eh.disable) {
      this.eh.disable();
    }

    // Disable context menus for editing
    this.disableEditingContextMenus();

    // Add visual feedback by changing cursor
    const cyContainer = this.cy.container();
    if (cyContainer) {
      cyContainer.style.cursor = 'not-allowed';
    }

    // Add event listeners to block editing operations
    this.cy.on('tap', (event) => {
      if (event.target !== this.cy) { // If clicking on a node or edge
        event.stopPropagation();
        event.preventDefault();
      }
    });

    // Block right-click context menu events with high priority
    this.cy.on('cxttap', 'node, edge', (event) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      log.info('Context menu blocked - lab is deployed');
      return false;
    });
    
    // Also block the general canvas right-click
    this.cy.on('cxttap', (event) => {
      if (event.target === this.cy) {
        event.stopImmediatePropagation();
        event.preventDefault();
        log.info('Canvas context menu blocked - lab is deployed');
        return false;
      }
      return true; // Allow other events to continue
    });

    // Show a message on any attempt to edit
    this.cy.on('grab', 'node', () => {
      log.info('Node grab blocked - lab is deployed');
      return false;
    });
  }

  /**
   * Disable editing-related context menus when lab is deployed
   */
  private disableEditingContextMenus(): void {
    // More aggressive approach to disable context menus
    try {
      // First try to destroy existing menus
      if ((this.cy as any).cxtmenu) {
        if (typeof (this.cy as any).cxtmenu === 'function') {
          // If it's a constructor function, try to access instances
          const instances = (this.cy as any)._private?.cxtmenu || [];
          if (Array.isArray(instances)) {
            instances.forEach((instance: any) => {
              if (instance && typeof instance.destroy === 'function') {
                instance.destroy();
              }
            });
          }
        } else if (typeof (this.cy as any).cxtmenu.destroy === 'function') {
          (this.cy as any).cxtmenu.destroy();
        }
      }
      
      // Clear cxtmenu data from cytoscape
      (this.cy as any)._private = (this.cy as any)._private || {};
      (this.cy as any)._private.cxtmenu = undefined;
      
      // Remove any cxtmenu-related data from nodes and edges
      this.cy.elements().removeData('cxtmenu');
      
      log.info('Context menus disabled');
    } catch (error) {
      log.error(`Error disabling context menus: ${error}`);
    }
  }

  /**
   * Setup listener for deployment state changes from the extension
   */
  private setupDeploymentStateListener(): void {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'deployment-state-changed') {
        log.info(`Received deployment state change: ${message.isLabDeployed}`);
        
        // Update window global variables
        (window as any).isLabDeployed = message.isLabDeployed;
        
        // Update local state
        const wasLocked = this.isEditingLocked;
        this.checkDeploymentState();
        
        // Apply or remove restrictions based on new state
        if (this.isEditingLocked && !wasLocked) {
          // Lab was deployed - apply restrictions
          this.applyEditingRestrictions();
        } else if (!this.isEditingLocked && wasLocked) {
          // Lab was undeployed - remove restrictions (requires reload)
          this.removeEditingRestrictions();
        }
        
        // Update floating action panel if it exists
        if (this.floatingActionPanel) {
          // Update the data attributes on the FAB button first
          const fabMain = document.getElementById('fab-main');
          if (fabMain) {
            fabMain.setAttribute('data-is-lab-deployed', message.isLabDeployed.toString());
          }
          // Then trigger the icon update
          this.floatingActionPanel.updateIconForDeploymentState();
        }
      }
    });
  }

  /**
   * Remove editing restrictions when lab is undeployed
   */
  private removeEditingRestrictions(): void {
    log.info('Removing editing restrictions - lab is undeployed');
    
    // Re-enable node dragging
    this.cy.nodes().grabify();
    
    // Re-enable edge creation if edgehandles exists
    if (this.eh && this.eh.enable) {
      this.eh.enable();
    }
    
    // Restore normal cursor
    const cyContainer = this.cy.container();
    if (cyContainer) {
      cyContainer.style.cursor = '';
    }
    
    // Re-initialize context menus now that editing is allowed
    this.initializeContextMenu('edit');
    
    log.info('Editing restrictions removed and context menus re-enabled');
  }

  // Add automatic save on change
  private setupAutoSave(): void {
    // Debounced save function
    const autoSave = this.debounce(async () => {
      if (this.isEdgeHandlerActive || this.isEditingBlocked()) {
        return;
      }
      const suppressNotification = true;
      await this.saveManager.viewportButtonsSaveTopo(this.cy, suppressNotification);
    }, 500); // Wait 500ms after last change before saving

    // Listen for topology changes
    this.cy.on('add remove data', autoSave);
    this.cy.on('position', (event) => {
      // Avoid autosave while a node is actively being dragged
      if (!event.target.grabbed()) {
        autoSave();
      }
    });
    this.cy.on('dragfree', 'node', autoSave);
  }

  /**
   * Creates an instance of TopologyWebviewController.
   * @param containerId - The ID of the container element for Cytoscape.
   * @throws Will throw an error if the container element is not found.
   */
  constructor(containerId: string, mode: 'edit' | 'view' = 'edit') {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error("Cytoscape container element not found");
    }

    // Initialize message sender
    this.messageSender = new VscodeMessageSender();

    // Check deployment state to determine if editing should be locked
    this.checkDeploymentState();

    // Detect and apply color scheme
    const theme = this.detectColorScheme();

    // Initialize Cytoscape instance
    this.cy = createConfiguredCytoscape(container, { wheelSensitivity: 2 });

    this.cy.on('tap', (event) => {
      this.cyEvent = event as cytoscape.EventObject;
      log.debug(`Cytoscape event: ${event.type}`);
    });

    // Enable grid guide extension (casting cy as any to satisfy TypeScript)
    const gridColor = theme === 'dark' ? '#666666' : '#cccccc';
    (this.cy as any).gridGuide({
      snapToGridOnRelease: true,
      snapToGridDuringDrag: false,
      snapToAlignmentLocationOnRelease: true,
      snapToAlignmentLocationDuringDrag: false,
      distributionGuidelines: false,
      geometricGuideline: false,
      initPosAlignment: false,
      centerToEdgeAlignment: false,
      resize: false,
      parentPadding: false,
      drawGrid: true,

      gridSpacing: 14,
      snapToGridCenter: true,

      zoomDash: true,
      panGrid: true,
      gridStackOrder: -1,
      gridColor,
      lineWidth: 0.5,

      guidelinesStackOrder: 4,
      guidelinesTolerance: 2.0,
      guidelinesStyle: {
        strokeStyle: "#8b7d6b",
        geometricGuidelineRange: 400,
        range: 100,
        minDistRange: 10,
        distGuidelineOffset: 10,
        horizontalDistColor: "#ff0000",
        verticalDistColor: "#00ff00",
        initPosAlignmentColor: "#0000ff",
        lineDash: [0, 0],
        horizontalDistLine: [0, 0],
        verticalDistLine: [0, 0],
        initPosAlignmentLine: [0, 0],
      },

      parentSpacing: -1,
    });

    loadCytoStyle(this.cy);
    fetchAndLoadData(this.cy, this.messageSender);

    // Fetch and load data from the environment and update the subtitle
    (async () => {
      try {
        const result = await fetchAndLoadDataEnvironment(["clab-name"]);
        this.updateSubtitle(result["clab-name"] || "Unknown");
      } catch (error) {
        log.error(`Error loading lab name: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    // Register events based on mode
    this.registerEvents(mode);
    if (mode === 'edit') {
      this.initializeEdgehandles();
    }
    // Initialize context menu for both edit and view modes (for free text at minimum)
    // Only initialize if lab is not deployed (to prevent right-click menus when locked)
    if (!this.isEditingLocked) {
      this.initializeContextMenu(mode);
    }

    // Initiate managers and panels
    this.saveManager = new ManagerSaveTopo(this.messageSender);
    this.undoManager = new ManagerUndo(this.messageSender);
    this.addNodeManager = new ManagerAddContainerlabNode();

    // Initialize free text manager for both edit and view modes
    this.freeTextManager = new ManagerFreeText(this.cy, this.messageSender);

    if (mode === 'edit') {
      this.viewportPanels = new ManagerViewportPanels(this.saveManager, this.cy);
      this.floatingActionPanel = new ManagerFloatingActionPanel(this.cy, this.addNodeManager);
    }
    this.groupManager = getGroupManager(this.cy, mode);
    this.groupManager.initializeWheelSelection();
    this.groupManager.initializeGroupManagement();
    this.layoutAlgoManager = layoutAlgoManagerSingleton;
    this.zoomToFitManager = zoomToFitManagerSingleton;
    this.labelEndpointManager = labelEndpointManagerSingleton;
    this.reloadTopoManager = getReloadTopoManager(this.messageSender);

    // Set editor flag based on mode
    this.isViewportDrawerClabEditorChecked = mode === 'edit';

    if (mode === 'edit') {
      this.setupAutoSave();
      // Apply editing restrictions if lab is deployed
      this.applyEditingRestrictions();
    }

    // Create capture viewport manager with the required method
    this.captureViewportManager = {
      viewportButtonsCaptureViewportAsSvg: (cy: cytoscape.Core) => {
        exportViewportAsSvg(cy);
      }
    };

    // Expose layout functions globally for HTML event handlers
    window.viewportButtonsLayoutAlgo = this.layoutAlgoManager.viewportButtonsLayoutAlgo.bind(this.layoutAlgoManager);
    window.layoutAlgoChange = this.layoutAlgoManager.layoutAlgoChange.bind(this.layoutAlgoManager);
    
    // Setup listener for deployment state changes from the extension
    this.setupDeploymentStateListener();
    window.viewportDrawerLayoutGeoMap = this.layoutAlgoManager.viewportDrawerLayoutGeoMap.bind(this.layoutAlgoManager);
    window.viewportDrawerDisableGeoMap = this.layoutAlgoManager.viewportDrawerDisableGeoMap.bind(this.layoutAlgoManager);
    window.viewportDrawerLayoutForceDirected = this.layoutAlgoManager.viewportDrawerLayoutForceDirected.bind(this.layoutAlgoManager);
    window.viewportDrawerLayoutForceDirectedRadial = this.layoutAlgoManager.viewportDrawerLayoutForceDirectedRadial.bind(this.layoutAlgoManager);
    window.viewportDrawerLayoutVertical = this.layoutAlgoManager.viewportDrawerLayoutVertical.bind(this.layoutAlgoManager);
    window.viewportDrawerLayoutHorizontal = this.layoutAlgoManager.viewportDrawerLayoutHorizontal.bind(this.layoutAlgoManager);
    window.viewportDrawerPreset = this.layoutAlgoManager.viewportDrawerPreset.bind(this.layoutAlgoManager);
    window.viewportButtonsGeoMapPan = this.layoutAlgoManager.viewportButtonsGeoMapPan.bind(this.layoutAlgoManager);
    window.viewportButtonsGeoMapEdit = this.layoutAlgoManager.viewportButtonsGeoMapEdit.bind(this.layoutAlgoManager);

    // Expose topology overview function
    window.viewportButtonsTopologyOverview = this.viewportButtonsTopologyOverview.bind(this);

    // Expose additional functions used by shared navbar buttons
    window.viewportButtonsZoomToFit = () =>
      this.zoomToFitManager.viewportButtonsZoomToFit(this.cy);
    window.viewportButtonsLabelEndpoint = () =>
      this.labelEndpointManager.viewportButtonsLabelEndpoint(this.cy);
    window.viewportButtonsCaptureViewportAsSvg = () =>
      this.captureViewportManager.viewportButtonsCaptureViewportAsSvg(this.cy);
    window.viewportButtonsReloadTopo = () =>
      this.reloadTopoManager.viewportButtonsReloadTopo(this.cy);
    window.viewportButtonsSaveTopo = () =>
      this.saveManager.viewportButtonsSaveTopo(this.cy);
    window.viewportButtonsUndo = () =>
      this.undoManager.viewportButtonsUndo();

    window.addEventListener('message', (event) => {
      const msg = event.data as any;
      if (msg && msg.type === 'yaml-saved') {
        fetchAndLoadData(this.cy, this.messageSender);
      } else if (msg && msg.type === 'updateTopology') {
        try {
          const elements = msg.data as any[];
          if (Array.isArray(elements)) {
            elements.forEach((el) => {
              const id = el?.data?.id;
              if (!id) {
                return;
              }
              const existing = this.cy.getElementById(id);
              if (existing && existing.length > 0) {
                existing.data(el.data);
                if (typeof el.classes === 'string') {
                  existing.classes(el.classes);
                }
              } else {
                this.cy.add(el);
              }
            });
            loadCytoStyle(this.cy);
          }
        } catch (error) {
          log.error(`Error processing updateTopology message: ${error}`);
        }
      }
    });
  }

  /**
   * Initializes the edgehandles extension with defined options.
   * Enables the edgehandles instance for creating edges.
   * @private
   */
  private initializeEdgehandles(): void {
    const edgehandlesOptions = {
      hoverDelay: 50,
      snap: false,
      snapThreshold: 10,
      snapFrequency: 150,
      noEdgeEventsInDraw: false,
      disableBrowserGestures: false,
      handleNodes: 'node[topoViewerRole != "freeText"]',
      canConnect: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular): boolean => {
        const sourceRole = sourceNode.data('topoViewerRole');
        const targetRole = targetNode.data('topoViewerRole');
        return (
          sourceRole !== 'freeText' &&
          targetRole !== 'freeText' &&
          !sourceNode.same(targetNode) &&
          !sourceNode.isParent() &&
          !targetNode.isParent() &&
          targetRole !== 'dummyChild'
        );
      },
      edgeParams: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular): EdgeData => {
        const ifaceMap = window.ifacePatternMapping || {};
        const srcKind = sourceNode.data('extraData')?.kind || 'default';
        const dstKind = targetNode.data('extraData')?.kind || 'default';
        const srcPattern: string = ifaceMap[srcKind] || 'eth{n}';
        const dstPattern: string = ifaceMap[dstKind] || 'eth{n}';

        const srcCount = (this.interfaceCounters[sourceNode.id()] ?? 0) + 1;
        this.interfaceCounters[sourceNode.id()] = srcCount;
        const dstCount = (this.interfaceCounters[targetNode.id()] ?? 0) + 1;
        this.interfaceCounters[targetNode.id()] = dstCount;

        return {
          id: `${sourceNode.id()}-${targetNode.id()}`,
          source: sourceNode.id(),
          target: targetNode.id(),
          sourceEndpoint: srcPattern.replace('{n}', srcCount.toString()),
          targetEndpoint: dstPattern.replace('{n}', dstCount.toString()),
        };
      },
    };

    this.eh = (this.cy as any).edgehandles(edgehandlesOptions);
    this.eh.enable();
    this.isEdgeHandlerActive = false;
  }


  /**
 * Initializes the circular context menu on nodes.
  */
  private initializeContextMenu(mode: 'edit' | 'view' = 'edit'): void {
    const self = this;
    // Context menu for free text elements (available in both edit and view modes)
    this.cy.cxtmenu({
      selector: 'node[topoViewerRole = "freeText"]',
      commands: [
        {
          content: `<div style="display:flex; flex-direction:column; align-items:center; line-height:1;">
                      <i class="fas fa-pen-to-square" style="font-size:1.5em;"></i>
                      <div style="height:0.5em;"></div>
                      <span>Edit Text</span>
                    </div>`,
          select: (ele: cytoscape.Singular) => {
            if (!ele.isNode()) {
              return;
            }
            // Trigger edit for free text
            this.freeTextManager?.editFreeText(ele.id());
          }
        },
        {
          content: `<div style="display:flex; flex-direction:column; align-items:center; line-height:1;">
                      <i class="fas fa-trash-alt" style="font-size:1.5em;"></i>
                      <div style="height:0.5em;"></div>
                      <span>Remove Text</span>
                    </div>`,
          select: (ele: cytoscape.Singular) => {
            if (!ele.isNode()) {
              return;
            }
            // Remove free text
            this.freeTextManager?.removeFreeTextAnnotation(ele.id());
          }
        }
      ],
      menuRadius: 60, // smaller fixed radius for text menu
      fillColor: 'rgba(31, 31, 31, 0.75)', // the background colour of the menu
      activeFillColor: 'rgba(66, 88, 255, 1)', // the colour used to indicate the selected command
      activePadding: 5, // additional size in pixels for the active command
      indicatorSize: 0, // the size in pixels of the pointer to the active command
      separatorWidth: 3, // the empty spacing in pixels between successive commands
      spotlightPadding: 4, // minimal spacing to keep menu close
      adaptativeNodeSpotlightRadius: false, // DON'T adapt to node size - keep it small
      minSpotlightRadius: 20, // fixed small spotlight
      maxSpotlightRadius: 20, // fixed small spotlight
      openMenuEvents: 'cxttap', // single right-click to open menu
      itemColor: 'white', // the colour of text in the command's content
      itemTextShadowColor: 'rgba(61, 62, 64, 1)', // the text shadow colour of the command's content
      zIndex: 9999, // the z-index of the ui div
      atMouse: false, // draw menu at mouse position
      outsideMenuCancel: 10 // cancel menu when clicking outside
    });

    // Only initialize other context menus in edit mode
    if (mode === 'edit') {
      // Context menu for regular nodes (excluding groups, dummyChild, and freeText)
      this.cy.cxtmenu({
        selector: 'node[topoViewerRole != "group"][topoViewerRole != "dummyChild"][topoViewerRole != "freeText"]',
        commands: [
        {
          content: `<div style="display:flex; flex-direction:column; align-items:center; line-height:1;">
                      <i class="fas fa-pen-to-square" style="font-size:1.5em;"></i>
                      <div style="height:0.5em;"></div>
                      <span>Edit Node</span>
                    </div>`,
          select: (ele: cytoscape.Singular) => {
            if (!ele.isNode()) {
              return;
            }
            // inside here TS infers ele is NodeSingular
              this.viewportPanels?.panelNodeEditor(ele);
          }
        },
        {
          content: `<div style="display:flex; flex-direction:column; align-items:center; line-height:1;">
                      <i class="fas fa-trash-alt" style="font-size:1.5em;"></i>
                      <div style="height:0.5em;"></div>
                      <span>Delete Node</span>
                    </div>`,
          select: (ele: cytoscape.Singular) => {
            if (!ele.isNode()) {
              return;
            }
            const parent = ele.parent();
            ele.remove();
            // If parent exists and now has no children, remove the parent
            if (parent.nonempty() && parent.children().length === 0) {
              parent.remove();
            }
          }
        },

        {
          content: `<div style="display:flex; flex-direction:column; align-items:center; line-height:1;">
                      <i class="fas fa-link" style="font-size:1.5em;"></i>
                      <div style="height:0.5em;"></div>
                      <span>Add Link</span>
                    </div>`,
          select: (ele: cytoscape.Singular) => {
            // initiate edgehandles drawing from this node
            self.isEdgeHandlerActive = true;
            self.eh.start(ele);
          }
        }
      ],
      menuRadius: 110, // the radius of the menu
      fillColor: 'rgba(31, 31, 31, 0.75)', // the background colour of the menu
      activeFillColor: 'rgba(66, 88, 255, 1)', // the colour used to indicate the selected command
      activePadding: 5, // additional size in pixels for the active command
      indicatorSize: 0, // the size in pixels of the pointer to the active command, will default to the node size if the node size is smaller than the indicator size,
      separatorWidth: 3, // the empty spacing in pixels between successive commands
      spotlightPadding: 20, // extra spacing in pixels between the element and the spotlight
      adaptativeNodeSpotlightRadius: true, // specify whether the spotlight radius should adapt to the node size
      minSpotlightRadius: 24, // the minimum radius in pixels of the spotlight (ignored for the node if adaptativeNodeSpotlightRadius is enabled but still used for the edge & background)
      maxSpotlightRadius: 38, // the maximum radius in pixels of the spotlight (ignored for the node if adaptativeNodeSpotlightRadius is enabled but still used for the edge & background)
      openMenuEvents: 'cxttap', // single right-click to open menu
      itemColor: 'white', // the colour of text in the command's content
      itemTextShadowColor: 'rgba(61, 62, 64, 1)', // the text shadow colour of the command's content
      zIndex: 9999, // the z-index of the ui div
      atMouse: false, // draw menu at mouse position
      outsideMenuCancel: 10 // cancel menu when clicking outside
    });

    this.cy.cxtmenu({
      selector: 'node:parent, node[topoViewerRole = "dummyChild"], node[topoViewerRole = "group"]',
      commands: [
        {
          content: `<div style="display:flex; flex-direction:column; align-items:center; line-height:1;">
                      <i class="fas fa-pen-to-square" style="font-size:1.5em;"></i>
                      <div style="height:0.5em;"></div>
                      <span>Edit Group</span>
                    </div>`,
          select: (ele: cytoscape.Singular) => {
            if (!ele.isNode()) {
              return;
            }
            // prevent global canvas click handler from closing panels
              this.viewportPanels?.setNodeClicked(true);
            // inside here TS infers ele is NodeSingular
            // this.viewportPanels.panelNodeEditor(ele);
            if (ele.data("topoViewerRole") == "dummyChild") {
              log.debug(`Editing parent of dummyChild: ${ele.parent().first().id()}`);
              this.groupManager.showGroupEditor(ele.parent().first().id());
            } else if (ele.data("topoViewerRole") == "group") {
              this.groupManager.showGroupEditor(ele.id());
            }
          }
        },
        {
          content: `<div style="display:flex; flex-direction:column; align-items:center; line-height:1;">
                      <i class="fas fa-trash-alt" style="font-size:1.5em;"></i>
                      <div style="height:0.5em;"></div>
                      <span>Delete Group</span>
                    </div>`,
          select: (ele: cytoscape.Singular) => {
            if (!ele.isNode()) {
              return;
            }
            let groupId: string;
            if (ele.data("topoViewerRole") == "dummyChild") {
              groupId = ele.parent().first().id();
            } else if (ele.data("topoViewerRole") == "group" || ele.isParent()) {
              groupId = ele.id();
            } else {
              return;
            }
            this.groupManager.directGroupRemoval(groupId);
          }
        }
      ],
      menuRadius: 110, // the radius of the menu
      fillColor: 'rgba(31, 31, 31, 0.75)', // the background colour of the menu
      activeFillColor: 'rgba(66, 88, 255, 1)', // the colour used to indicate the selected command
      activePadding: 5, // additional size in pixels for the active command
      indicatorSize: 0, // the size in pixels of the pointer to the active command, will default to the node size if the node size is smaller than the indicator size,
      separatorWidth: 3, // the empty spacing in pixels between successive commands
      spotlightPadding: 20, // extra spacing in pixels between the element and the spotlight
      adaptativeNodeSpotlightRadius: true, // specify whether the spotlight radius should adapt to the node size
      minSpotlightRadius: 24, // the minimum radius in pixels of the spotlight (ignored for the node if adaptativeNodeSpotlightRadius is enabled but still used for the edge & background)
      maxSpotlightRadius: 38, // the maximum radius in pixels of the spotlight (ignored for the node if adaptativeNodeSpotlightRadius is enabled but still used for the edge & background)
      openMenuEvents: 'cxttap', // single right-click to open menu
      itemColor: 'white', // the colour of text in the command's content
      itemTextShadowColor: 'rgba(61, 62, 64, 1)', // the text shadow colour of the command's content
      zIndex: 9999, // the z-index of the ui div
      atMouse: false, // draw menu at mouse position
      outsideMenuCancel: 10 // cancel menu when clicking outside
    });

    this.cy.cxtmenu({
      selector: 'edge',
      commands: [
        {
          content: `
            <div style="display:flex;flex-direction:column;align-items:center;line-height:1;">
              <i class="fas fa-pen" style="font-size:1.5em;"></i>
              <div style="height:0.5em;"></div>
              <span>Edit Link</span>
            </div>`,
          select: (ele: cytoscape.Singular) => {
            if (!ele.isEdge()) {
              return;
            }
            // Set edgeClicked to true to prevent the panel from closing immediately
              this.viewportPanels?.setEdgeClicked(true);
              // you'll need to implement panelEdgeEditor in ManagerViewportPanels
              this.viewportPanels?.panelEdgeEditor(ele);
          }
        },
        {
          content: `
            <div style="display:flex;flex-direction:column;align-items:center;line-height:1;">
              <i class="fas fa-trash-alt" style="font-size:1.5em;"></i>
              <div style="height:0.5em;"></div>
              <span>Delete Link</span>
            </div>`,
          select: (ele: cytoscape.Singular) => {
            ele.remove();
          }
        }
      ],
      menuRadius: 80, // the radius of the menu
      fillColor: 'rgba(31, 31, 31, 0.75)', // the background colour of the menu
      activeFillColor: 'rgba(66, 88, 255, 1)', // the colour used to indicate the selected command
      activePadding: 5, // additional size in pixels for the active command
      indicatorSize: 0, // the size in pixels of the pointer to the active command, will default to the node size if the node size is smaller than the indicator size,
      separatorWidth: 3, // the empty spacing in pixels between successive commands
      spotlightPadding: 0, // extra spacing in pixels between the element and the spotlight
      adaptativeNodeSpotlightRadius: true, // specify whether the spotlight radius should adapt to the node size
      minSpotlightRadius: 0, // the minimum radius in pixels of the spotlight (ignored for the node if adaptativeNodeSpotlightRadius is enabled but still used for the edge & background)
      maxSpotlightRadius: 0, // the maximum radius in pixels of the spotlight (ignored for the node if adaptativeNodeSpotlightRadius is enabled but still used for the edge & background)
      openMenuEvents: 'cxttap', // single right-click to open menu
      itemColor: 'white', // the colour of text in the command's content
      itemTextShadowColor: 'rgba(61, 62, 64, 1)', // the text shadow colour of the command's content
      zIndex: 9999, // the z-index of the ui div
      atMouse: false, // draw menu at mouse position
      outsideMenuCancel: 10 // cancel menu when clicking outside
    });
    } // end if (mode === 'edit')
  }



  /**
   * Registers event handlers for Cytoscape elements such as canvas, nodes, and edges.
   * @private
   */
  private async registerEvents(mode: 'edit' | 'view'): Promise<void> {
    if (mode === 'edit') {
      registerCyEventHandlers({
        cy: this.cy,
        onCanvasClick: (event) => {
          const mouseEvent = event.originalEvent as MouseEvent;
          if (mouseEvent.shiftKey && this.isViewportDrawerClabEditorChecked) {
            log.debug('Canvas clicked with Shift key - adding node.');
            this.addNodeManager.viewportButtonsAddContainerlabNode(this.cy, this.cyEvent as cytoscape.EventObject);
          }
        },
        onNodeClick: async (event) => {
            this.viewportPanels!.nodeClicked = true; // prevent panels from closing
          const node = event.target;
          log.debug(`Node clicked: ${node.id()}`);
          const originalEvent = event.originalEvent as MouseEvent;
          const extraData = node.data("extraData");
          const isNodeInEditMode = node.data("editor") === "true";
          switch (true) {
            case originalEvent.ctrlKey && node.isChild():
              log.debug(`Orphaning node: ${node.id()} from parent: ${node.parent().id()}`);
              node.move({ parent: null });
              break;
            case originalEvent.shiftKey && node.data('topoViewerRole') !== 'freeText':
              log.debug(`Shift+click on node: starting edge creation from node: ${extraData?.longname || node.id()}`);
              this.isEdgeHandlerActive = true;
              this.eh.start(node);
              break;
            case originalEvent.altKey && isNodeInEditMode:
              log.debug(`Alt+click on node: deleting node ${extraData?.longname || node.id()}`);
              node.remove();
              break;
            case (node.data("topoViewerRole") == "textbox"):
              break;
            default:
              break;
          }
        },
        onEdgeClick: (event) => {
            this.viewportPanels!.edgeClicked = true; // prevent panels from closing
          const edge = event.target;
          const originalEvent = event.originalEvent as MouseEvent;
          if (originalEvent.altKey && this.isViewportDrawerClabEditorChecked) {
            log.debug(`Alt+click on edge: deleting edge ${edge.id()}`);
            edge.remove();
          }
        }
      });

      // Edgehandles lifecycle events.
      this.cy.on('ehstart', () => {
        this.isEdgeHandlerActive = true;
      });

      this.cy.on('ehstop', () => {
        this.isEdgeHandlerActive = false;
      });

      this.cy.on('ehcancel', () => {
        this.isEdgeHandlerActive = false;
      });

      // Edge creation completion via edgehandles.
      this.cy.on('ehcomplete', (_event, sourceNode, targetNode, addedEdge) => {
        log.debug(`Edge created from ${sourceNode.id()} to ${targetNode.id()}`);
        log.debug(`Added edge: ${addedEdge.id()}`);

        setTimeout(() => {
          this.isEdgeHandlerActive = false;
        }, 100);

        const sourceEndpoint = this.getNextEndpoint(sourceNode.id());
        const targetEndpoint = this.getNextEndpoint(targetNode.id());
        addedEdge.data({ sourceEndpoint, targetEndpoint, editor: 'true' });
      });

    } else {
      const cy = this.cy;
      registerCyEventHandlers({
        cy,
        onNodeClick: async (event: any) => {
          const node = event.target;
          topoViewerState.nodeClicked = true;
          cy.edges().removeStyle("line-color");
          topoViewerState.selectedEdge = null;
          topoViewerState.edgeClicked = false;
          const extraData = node.data("extraData") || {};
          const originalEvent = event.originalEvent as MouseEvent;
          if (node.isParent() || node.data('topoViewerRole') === 'group') {
            this.groupManager.showGroupEditor(node);
            return;
          }
          if (node.data("topoViewerRole") === "textbox" || node.data("topoViewerRole") === "dummyChild") {
            return;
          }
          // Don't show node properties for free text nodes
          if (node.data("topoViewerRole") === "freeText") {
            return;
          }
          if (!originalEvent.altKey && !originalEvent.ctrlKey && !originalEvent.shiftKey) {
            const panelOverlays = document.getElementsByClassName("panel-overlay");
            Array.from(panelOverlays).forEach(panel => (panel as HTMLElement).style.display = "none");
            const panelNode = document.getElementById("panel-node");
            if (panelNode) {
              panelNode.style.display = panelNode.style.display === "none" ? "block" : "none";
              const nameEl = document.getElementById("panel-node-name");
              if (nameEl) nameEl.textContent = extraData.longname || node.data("name") || node.id();
              const kindEl = document.getElementById("panel-node-kind");
              if (kindEl) kindEl.textContent = extraData.kind || "";
              const mgmtIpv4El = document.getElementById("panel-node-mgmtipv4");
              if (mgmtIpv4El) mgmtIpv4El.textContent = extraData.mgmtIpv4Address || "";
              const mgmtIpv6El = document.getElementById("panel-node-mgmtipv6");
              if (mgmtIpv6El) mgmtIpv6El.textContent = extraData.mgmtIpv6Address || "";
              const fqdnEl = document.getElementById("panel-node-fqdn");
              if (fqdnEl) fqdnEl.textContent = extraData.fqdn || "";
              const roleEl = document.getElementById("panel-node-topoviewerrole");
              if (roleEl) roleEl.textContent = node.data("topoViewerRole") || "";
              const stateEl = document.getElementById("panel-node-state");
              if (stateEl) stateEl.textContent = extraData.state || "";
              const imageEl = document.getElementById("panel-node-image");
              if (imageEl) imageEl.textContent = extraData.image || "";
              topoViewerState.selectedNode = extraData.longname || node.id();
            }
          }
        },
        onEdgeClick: async (event: any) => {
          const edge = event.target;
          topoViewerState.edgeClicked = true;
          const panelOverlays = document.getElementsByClassName("panel-overlay");
          Array.from(panelOverlays).forEach(panel => (panel as HTMLElement).style.display = "none");
          cy.edges().removeStyle("line-color");
          if (edge.data("editor") === "true") {
            edge.style("line-color", "#32CD32");
          } else {
            edge.style("line-color", "#0043BF");
          }
          const panelLink = document.getElementById("panel-link");
          if (panelLink) {
            panelLink.style.display = "block";
            const extraData = edge.data("extraData") || {};
            const linkNameEl = document.getElementById("panel-link-name");
            if (linkNameEl) {
              linkNameEl.innerHTML = `┌ ${edge.data("source")} :: ${edge.data("sourceEndpoint") || ""}<br>└ ${edge.data("target")} :: ${edge.data("targetEndpoint") || ""}`;
            }
            const endpointANameEl = document.getElementById("panel-link-endpoint-a-name");
            if (endpointANameEl) {
              endpointANameEl.textContent = `${edge.data("source")} :: ${edge.data("sourceEndpoint") || ""}`;
            }
            const endpointAMacEl = document.getElementById("panel-link-endpoint-a-mac-address");
            if (endpointAMacEl) {
              endpointAMacEl.textContent = extraData.clabSourceMacAddress || "N/A";
            }
            const endpointAMtuEl = document.getElementById("panel-link-endpoint-a-mtu");
            if (endpointAMtuEl) {
              endpointAMtuEl.textContent = extraData.clabSourceMtu || "N/A";
            }
            const endpointATypeEl = document.getElementById("panel-link-endpoint-a-type");
            if (endpointATypeEl) {
              endpointATypeEl.textContent = extraData.clabSourceType || "N/A";
            }
            const endpointBNameEl = document.getElementById("panel-link-endpoint-b-name");
            if (endpointBNameEl) {
              endpointBNameEl.textContent = `${edge.data("target")} :: ${edge.data("targetEndpoint") || ""}`;
            }
            const endpointBMacEl = document.getElementById("panel-link-endpoint-b-mac-address");
            if (endpointBMacEl) {
              endpointBMacEl.textContent = extraData.clabTargetMacAddress || "N/A";
            }
            const endpointBMtuEl = document.getElementById("panel-link-endpoint-b-mtu");
            if (endpointBMtuEl) {
              endpointBMtuEl.textContent = extraData.clabTargetMtu || "N/A";
            }
            const endpointBTypeEl = document.getElementById("panel-link-endpoint-b-type");
            if (endpointBTypeEl) {
              endpointBTypeEl.textContent = extraData.clabTargetType || "N/A";
            }
            topoViewerState.selectedEdge = edge.data("id");
          }
        },
        onCanvasClick: () => {
          const panelOverlays = document.getElementsByClassName('panel-overlay');
          for (let i = 0; i < panelOverlays.length; i++) {
            (panelOverlays[i] as HTMLElement).style.display = 'none';
          }
          const viewportDrawer = document.getElementsByClassName('viewport-drawer');
          for (let i = 0; i < viewportDrawer.length; i++) {
            (viewportDrawer[i] as HTMLElement).style.display = 'none';
          }
          topoViewerState.nodeClicked = false;
          topoViewerState.edgeClicked = false;
          cy.edges().removeStyle("line-color");
          topoViewerState.selectedEdge = null;
        }
      });
    }

    // Drag-and-drop reparenting logic is now handled by groupManager.initializeGroupManagement()


  }

  // /**
  //  * Adds a new node at the specified position.
  //  * @param position - The position where the node will be added.
  //  * @public
  //  */
  // public addNodeAtPosition(position: cytoscape.Position): void {
  //   // const newNodeId = `id:nodeId-${this.cy.nodes().length + 1}`;
  //   const newNodeId = `nodeId-${this.cy.nodes().length + 1}`;

  //   const newNodeData: NodeData = {
  //     id: newNodeId,
  //     editor: "true",
  //     weight: "30",
  //     // name: newNodeId.split(":")[1]
  //     name: newNodeId,
  //     parent: "",
  //     topoViewerRole: "pe",
  //     sourceEndpoint: "",
  //     targetEndpoint: "",
  //     containerDockerExtraAttribute: { state: "", status: "" },
  //     extraData: { kind: "nokia_srlinux", longname: "", image: "", mgmtIpv4Addresss: "" },
  // };
  //   this.cy.add({ group: 'nodes', data: newNodeData, position });
  // }

  /**
   * Determines the next available endpoint identifier for a given node.
   * @param nodeId - The ID of the node.
   * @returns The next available endpoint string.
   * @private
   */
  private getNextEndpoint(nodeId: string): string {
    const ifaceMap = window.ifacePatternMapping || {};
    const node = this.cy.getElementById(nodeId);
    const kind = node.data('extraData')?.kind || 'default';
    const pattern = ifaceMap[kind] || 'eth{n}';

    const placeholder = '__N__';
    const escaped = pattern
      .replace('{n}', placeholder)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(placeholder, '(\\d+)') + '$';
    const patternRegex = new RegExp(regexStr);

    const edges = this.cy.edges(`[source = "${nodeId}"], [target = "${nodeId}"]`);
    const usedNumbers = new Set<number>();
    edges.forEach(edge => {
      ['sourceEndpoint', 'targetEndpoint'].forEach(key => {
        const endpoint = edge.data(key);
        const isNodeEndpoint =
          (edge.data('source') === nodeId && key === 'sourceEndpoint') ||
          (edge.data('target') === nodeId && key === 'targetEndpoint');
        if (!endpoint || !isNodeEndpoint) return;
        const match = endpoint.match(patternRegex);
        if (match) {
          usedNumbers.add(parseInt(match[1], 10));
        }
      });
    });

    let endpointNum = 1;
    while (usedNumbers.has(endpointNum)) {
      endpointNum++;
    }

    return pattern.replace('{n}', endpointNum.toString());
  }

  /**
   * Detects the user's preferred color scheme and applies the corresponding theme.
   * @returns The applied theme ("dark" or "light").
   */
  public detectColorScheme(): 'light' | 'dark' {
    const bodyClassList = document.body?.classList;
    const darkMode = bodyClassList?.contains('vscode-dark') || bodyClassList?.contains('vscode-high-contrast');
    const theme: 'light' | 'dark' = darkMode ? 'dark' : 'light';
    this.applyTheme(theme);
    return theme;
  }

  /**
   * Applies a theme to the root element.
   * @param theme - The theme to apply ("dark" or "light").
   * @private
   */
  private applyTheme(theme: 'light' | 'dark'): void {
    const rootElement = document.getElementById('root');
    if (rootElement) {
      rootElement.setAttribute('data-theme', theme);
      log.debug(`Applied Theme: ${theme}`);
    } else {
      log.warn(`'root' element not found; cannot apply theme: ${theme}`);
    }
  }

  /**
   * Updates the subtitle element with the provided text.
   * @param newText - The new text to display in the subtitle.
   */
  public updateSubtitle(newText: string): void {
    const subtitleElement = document.getElementById("ClabSubtitle");
    if (subtitleElement) {
      subtitleElement.textContent = `Topology Editor ::: ${newText}`;
    } else {
      log.warn('Subtitle element not found');
    }
  }




  /**
   * Show/hide topology overview panel
   */
  public viewportButtonsTopologyOverview(): void {
    try {
      const overviewDrawer = document.getElementById("viewport-drawer-topology-overview");
      if (!overviewDrawer) {
        log.warn('Topology overview drawer not found');
        return;
      }

      // Toggle visibility
      if (overviewDrawer.style.display === "block") {
        overviewDrawer.style.display = "none";
      } else {
        // Hide all viewport drawers first
        const viewportDrawer = document.getElementsByClassName("viewport-drawer");
        for (let i = 0; i < viewportDrawer.length; i++) {
          (viewportDrawer[i] as HTMLElement).style.display = "none";
        }
        // Show the topology overview drawer
        overviewDrawer.style.display = "block";
      }
    } catch (error) {
      log.error(`Error in topology overview button: ${error}`);
    }
  }

  /**
   * Dispose of resources held by the engine.
   */
  public dispose(): void {
    this.messageSender.dispose();
  }
}


document.addEventListener('DOMContentLoaded', () => {
  const mode = (window as any).topoViewerMode === 'view' ? 'view' : 'edit';
  const controller = new TopologyWebviewController('cy', mode);
  // Store the instance for other modules
  topoViewerState.editorEngine = controller;
  topoViewerState.cy = controller.cy;
  // Expose for existing HTML bindings
  window.topologyWebviewController = controller;

  const gm = controller.groupManager;
  window.orphaningNode = gm.orphaningNode.bind(gm);
  window.createNewParent = gm.createNewParent.bind(gm);
  window.panelNodeEditorParentToggleDropdown = gm.panelNodeEditorParentToggleDropdown.bind(gm);
  window.nodeParentPropertiesUpdate = gm.nodeParentPropertiesUpdate.bind(gm);
  window.nodeParentPropertiesUpdateClose = gm.nodeParentPropertiesUpdateClose.bind(gm);
  window.nodeParentRemoval = gm.nodeParentRemoval.bind(gm);
  window.viewportButtonsAddGroup = gm.viewportButtonsAddGroup.bind(gm);
  window.showPanelGroupEditor = gm.showGroupEditor.bind(gm);

  window.addEventListener('unload', () => {
    controller.dispose();
  });
});

export default TopologyWebviewController;
