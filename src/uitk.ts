declare var pluralize; // @TODO: import me.
import {builtinId, copy, coerceInput, sortByLookup, sortByField, KEYS, autoFocus, uuid} from "./utils";
import {Element, Handler} from "./microReact";
import {dispatch, eve} from "./app";
import {PANE, uiState as _state, asEntity, entityTilesUI, listTile} from "./ui";
import {masonry as masonryRaw, MasonryLayout} from "./masonry";

//------------------------------------------------------------------------------
// Utilities
//------------------------------------------------------------------------------
export function resolveName(maybeId:string):string {
  let display = eve.findOne("display name", {id: maybeId});
  return display ? display.name : maybeId;
}
export function resolveId(maybeName:string):string {
  let display = eve.findOne("display name", {name: maybeName});
  return display ? display.id : maybeName;
}
export function resolveValue(maybeValue:string):string {
  maybeValue = coerceInput(maybeValue);
  if(typeof maybeValue !== "string") return maybeValue;
  let val = maybeValue.trim();
  let entity = asEntity(maybeValue);
  if(entity) return entity;
  //if(val[0] === "\"" && val[val.length - 1] === "\"") return val.slice(1, -1);
  return val;
}
export function isEntity(maybeId:string):boolean {
  return !!eve.findOne("entity", {entity: maybeId});
}

export function getNodeContent(node:HTMLElement) {
  if(node.nodeName === "INPUT") return (<HTMLInputElement>node).value;
  else return node.textContent;
}

function sortByFieldValue(field:string, direction = 1):(a, b) => number {
  var fwd = direction;
  var back = -1 * direction;
  return (rowA, rowB) => {
    let a = resolveName(resolveValue(rowA[field])), b = resolveName(resolveValue(rowB[field]));
    return (a === b) ? 0 :
      (a === undefined) ? fwd :
      (b === undefined) ? back :
      (a > b) ? fwd : back;
  };
}

let wordSplitter = /\s+/gi;
const statWeights = {links: 100, pages: 200, words: 1};
function classifyEntities(rawEntities:string[]) {
  let entities = rawEntities.slice();
  let collections:string[] = [];
  let systems:string[] = [];

  // Measure relatedness + length of entities
  // @TODO: mtimes of entities
  let relatedCounts:{[entity:string]: number} = {};
  let wordCounts:{[entity:string]: number} = {};
  let childCounts:{[collection:string]: number} = {};
  let scores:{[entity:string]: number} ={};
  for(let entity of entities) {
    let {content = ""} = eve.findOne("entity", {entity}) || {};
    relatedCounts[entity] = eve.find("directionless links", {entity}).length;
    wordCounts[entity] = content.trim().replace(wordSplitter, " ").split(" ").length;
    let {count:childCount = 0} = eve.findOne("collection", {collection: entity}) || {};
    childCounts[entity] = childCount;
    scores[entity] =
      relatedCounts[entity] * statWeights.links +
      wordCounts[entity] * statWeights.words +
      childCounts[entity] * statWeights.pages;
  }
  
  // Separate system entities
  let ix = 0;
  while(ix < entities.length) {
    if(eve.findOne("is a attributes", {collection: builtinId("system"), entity: entities[ix]})) {
      systems.push(entities.splice(ix, 1)[0]);
    } else ix++;
  }
  
  // Separate user collections from other entities
  ix = 0;
  while(ix < entities.length) {
    if(childCounts[entities[ix]]) {
      collections.push(entities.splice(ix, 1)[0]);
    } else ix++;
  }

  return {systems, collections, entities, scores, relatedCounts, wordCounts, childCounts};
}

export function getFields({example, whitelist, blacklist}:{example?:string[], whitelist?:string[], blacklist?:string[]}):string[] {
  // Determine display fields based on whitelist, blacklist, and the first row
  let fields;
  if(whitelist) {
    fields = whitelist.slice();
  } else {
    fields = Object.keys(example);
    if(blacklist) {
      for(let field of blacklist) {
        let fieldIx = fields.indexOf(field);
        if(fieldIx !== -1) {
          fields.splice(fieldIx, 1);
        }
      }
    }
  }
  return fields;
}


//------------------------------------------------------------------------------
// Handlers
//------------------------------------------------------------------------------
export function preventDefault(event) {
  event.preventDefault();
}
function preventDefaultUnlessFocused(event) {
  if(event.target !== document.activeElement) event.preventDefault();
}

function closePopup(event, elem, chain?) {
  let commit = false;
  if(!chain) {
    chain = dispatch("rerender");
    commit = true;
  }
  let paneId = elem.paneId || elem.data && elem.data.paneId;
  for(let {pane:child} of eve.find("ui pane parent", {parent: paneId})) {
    let popout = eve.findOne("ui pane", {pane: child, kind: PANE.POPOUT});
    if(!popout) continue;
    chain.dispatch("remove popup", {paneId: popout.pane});
  }
  if(commit) chain.commit();
}

export function navigate(event, elem) {
  let {paneId} = elem.data;
  if(elem.peek) dispatch("set popout", {parentId: paneId, contains: elem.link, x: event.clientX, y: event.clientY}).commit();
  else dispatch("set pane", {paneId, contains: elem.link}).commit();
  event.preventDefault();
  event.stopPropagation();
}

function blurOnEnter(event, elem) {
  if(event.keyCode === KEYS.ENTER) {
    event.target.blur();
    event.preventDefault();
  }
}

interface TableRowElem extends Element { table: string, row: any, rows?: any[] }
//interface TableCellElem extends Element { row: TableRowElem, field: string, rows?: any[]}
//interface TableFieldElem extends Element { table: string, field: string, direction?: number }

function updateEntityValue(event:CustomEvent, elem:TableCellElem) {
  let value = coerceInput(event.detail);
  let {table:tableElem, row, field} = elem;
  let entity = tableElem["entity"];
  throw new Error("@TODO: FIXME");
  // let rows = elem.rows || [row];
  // let chain = dispatch();
  // for(let row of rows) {
  //   if(field === "value" && row.value !== value && row.attribute !== undefined) {
  //     chain.dispatch("update entity attribute", {entity, attribute: row.attribute, prev: row.value, value});
  //   } else if(field === "attribute" && row.attribute !== value && row.value !== undefined) {
  //     chain.dispatch("rename entity attribute", {entity, prev: row.attribute, attribute: value, value: row.value});
  //   }
  // }
  // chain.commit();
}
function updateEntityAttributes(event:CustomEvent, elem:{row: TableRowElem}) {
  let {table:tableElem, row} = elem.row;
  let entity = tableElem["entity"];
  if(event.detail === "add") {
    let state = elem["state"]["adder"];
    var valid = elem["fields"].every((field) => {
      return state[field] !== undefined;
    });
    if(valid) {
      dispatch("add sourced eav", {entity, attribute: state.attribute, value: resolveValue(state.value)}).commit();
      elem["state"]["adder"] = {};
    }
  } else {
    dispatch("remove entity attribute", {entity, attribute: row.attribute, value: row.value}).commit();
  }
}
function sortTable(event, elem:TableFieldElem) {
  let {table, field = undefined, direction = undefined} = elem;
  if(field === undefined && direction === undefined) {
    field = event.target.value;
    direction = -1;
  }
  dispatch("sort table", {state: table.state, field, direction}).commit();
}

//------------------------------------------------------------------------------
// Embedded cell representation wrapper
//------------------------------------------------------------------------------
var uitk = this;
export function embeddedCell(elem):Element {
  let children = [];
  let {childInfo, rep} = elem;
  if(childInfo.constructor === Array) {
    for(let child of childInfo) {
      child["data"] = child["data"] || childInfo.params;
      children.push(uitk[rep](child));
    }
  } else {
    children.push(uitk[rep](childInfo));
  }
  children.push({c: "edit-button-container", children: [
    {c: "edit-button ion-edit", click: elem.click, cell: elem.cell}
  ]});
  return {c: "non-editing-embedded-cell", children, cell: elem.cell};
}

//------------------------------------------------------------------------------
// Representations for cards
//------------------------------------------------------------------------------

// @FIXME: if there isn't an ID here, microReact does the wrong thing, investigate
// after the release
export function card(elem:Element) {
  elem.c = `card ${elem.c || ""}`;
  return elem;
}

function toggleAddTile(event, elem) {
  dispatch("toggle add tile", {key: elem.key, entityId: elem.entityId}).commit();
}

function setTileAdder(event, elem) {
  dispatch("set tile adder", {key: elem.key, adder: elem.adder}).commit();
}

function closeCard(event, elem) {
  dispatch("close card", {paneId: elem.paneId}).commit();
}

function navigateRoot(event, elem) {
  let root = eve.findOne("ui pane", {kind: PANE.FULL})["pane"];
  dispatch("set pane", {paneId: root, contains: elem.entityId}).commit();
}

interface EntityEditorElem extends EntityElem { editor: CodeMirror.Editor }
export function entity(elem:EntityEditorElem) {
  let entityId = elem.entity;
  let paneId = elem.data.paneId;
  let key = elem.key || `${entityId}|${paneId}`;
  let state = _state.widget.card[key] || {};
  let name = eve.findOne("display name", {id: asEntity(entityId)}).name;
  let attrs = entityTilesUI(entityId, paneId, key);
  attrs.c += " page-attributes";
  // let editor = pageEditor(entityId, paneId, elem.editor);
  let adder = tileAdder({entityId, key});
  return {c: `entity ${state.showAdd ? "adding" : ""}`, children: [
    {c: "header", children: [
      {text: name},
      {c: "flex-grow spacer"},
      {c: `control ion-ios-upload-outline`, click: navigateRoot, entityId},
      {c: `control ${state.showAdd ? "ion-android-remove" : "ion-android-add"} add-tile`, click: toggleAddTile, key, entityId},
      {c: "control ion-android-close", click: closeCard, paneId},
    ]},
    adder,
    attrs,
    // editor,
  ]};
}

var measureSpan = document.createElement("span");
measureSpan.className = "measure-span";
document.body.appendChild(measureSpan);

export function autosizeInput(node, elem) {
  let minWidth = 50;
  measureSpan.style.fontSize = window.getComputedStyle(node, null)["font-size"];
  measureSpan.textContent = node.value;
  let measuredWidth = measureSpan.getBoundingClientRect().width;
  node.style.width = Math.ceil(Math.max(minWidth, measuredWidth)) + 5 + "px";
}

export function autosizeAndFocus(node, elem) {
  autosizeInput(node, elem);
  autoFocus(node, elem);
}

function trackPropertyAdderInput(event, elem) {
  let value = event.currentTarget.value;
  dispatch("set tile adder attribute", {key: elem.key, attribute: elem.attribute, value}).commit();
  if(event.currentTarget.nodeName === "INPUT") {
    autosizeInput(event.currentTarget, elem);
  }
}

function adderKeys(event, elem) {
  if(event.keyCode === KEYS.ENTER) {
    dispatch("submit tile adder", {key: elem.key, node: event.currentTarget}).commit();
  } else if(event.keyCode === KEYS.ESC) {
    dispatch("toggle add tile", {key: elem.key}).commit();
  }
}

function submitAdder(event, elem) {
  // @HACK: yeah...
  dispatch("submit tile adder", {key: elem.key, node: event.currentTarget.parentNode.parentNode.firstChild.firstChild}).commit();
}

function submitProperty(adder, state, node) {
  if(state.propertyProperty === undefined || state.propertyValue === undefined) return;
  dispatch("add sourced eav", {entity: state.entityId, attribute: state.propertyProperty, value: state.propertyValue, forceEntity: true}).commit();
  state.propertyValue = undefined;
  state.propertyProperty = undefined;
  //make sure the focus is in the value
  node.parentNode.firstChild.focus();
}

function propertyAdderUI(elem) {
  let {entityId, key} = elem;
  let state = _state.widget.card[key] || {};
  return {c: "property-adder", children: [
    {children: [
      {c: "tile small", children: [
        {c: "tile-content-wrapper", children: [
          {t: "input", c: "property", placeholder: "property", value: state.propertyProperty || "", attribute: "propertyProperty", input: trackPropertyAdderInput, postRender: autosizeAndFocus, keydown: adderKeys, entityId, key},
          {t: "input", c: "value", placeholder: "value", value: state.propertyValue || "", attribute: "propertyValue", input: trackPropertyAdderInput, postRender: autosizeInput, keydown: adderKeys, entityId, key},
        ]},
        {c: "controls flex-row", children: [
          {c: "ion-checkmark submit", click: submitAdder, key},
          {c: "ion-close cancel", click: setTileAdder, key},
        ]}
      ]}
    ]}
  ]};
}

function descriptionAdderUI(elem) {
  let {entityId, key} = elem;
  let state = _state.widget.card[key] || {};
  return {c: "property-adder description-adder", children: [
    {children: [
      {c: "tile full", children: [
        {c: "tile-content-wrapper", children: [
          {t: "textarea", c: "value", placeholder: "description", value: state.descriptionValue, attribute: "descriptionValue", input: trackPropertyAdderInput, postRender: autoFocus, keydown: adderKeys, entityId, key},
        ]},
        {c: "controls flex-row", children: [
          {c: "ion-checkmark submit", click: submitAdder, key},
          {c: "ion-close cancel", click: setTileAdder, key},
        ]}
      ]},
    ]}
  ]};
}

function submitDescription(adder, state, node) {
  let chain = dispatch("add sourced eav", {entity: state.entityId, attribute: "description", value: state.descriptionValue});
  state.descriptionValue = "";
  chain.dispatch("toggle add tile", {key: state.key}).commit();
}

function autosizeAndStoreListTileItem(event, elem) {
  let node = event.currentTarget;
  dispatch("add active tile item", {cardId: elem.cardId, attribute: elem.storeAttribute, tileId: elem.tileId, id: elem.storeId, value: node.value}).commit();
  autosizeInput(node, elem);
}

function collectionTileAdder(elem) {
  let {values, data, tileId, attribute, cardId, entityId, forceActive, reverseEntityAndValue, noProperty, rep="value", c:klass=""} = elem;
  tileId = tileId || attribute;
  let state = _state.widget.card[cardId] || {};
  let listChildren = [];
  let added = (state.activeTile ? state.activeTile.itemsToAdd : false) || [];
  let ix = 0;
  for(let add of added) {
    listChildren.push({c: "value", children: [
      {t: "input", placeholder: "add", value: add, attribute, entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId, input: autosizeAndStoreListTileItem, postRender: autosizeAndFocus, keydown: adderKeys, key: cardId}
    ]});
    ix++;
  }
  listChildren.push({c: "value", children: [
    {t: "input", placeholder: "add item", value: "", attribute, entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId, input: autosizeAndStoreListTileItem, postRender: ix === 0 ? autosizeAndFocus : autosizeInput, keydown: adderKeys, key: cardId}
  ]});
  let size = "full";
  let tileChildren = [];
  tileChildren.push({t: "input", c: "property", placeholder: `collection name`, attribute: "collectionProperty", value: state.collectionProperty, input: trackPropertyAdderInput, key: cardId});
  tileChildren.push({c: "list", children: listChildren});
  return {c: "property-adder collection-adder", children: [
    {children: [
      {c: "tile full", children: [
        {c: "tile-content-wrapper", children: tileChildren},
        {c: "controls flex-row", children: [
          {c: "ion-checkmark submit", click: submitAdder, key: cardId},
          {c: "ion-close cancel", click: setTileAdder, key: cardId},
        ]}
      ]},
    ]}
  ]};
}

function collectionAdderUI(elem) {
  let {entityId, key} = elem;
  let state = _state.widget.card[key] || {};
  let tile = collectionTileAdder({values: [], cardId: key, entityId, forceActive: true, tileId: "collectionAdder", data: {}, noProperty: true, });
  return tile;
}

function submitCollection(adder, state, node) {
  let chain;
  // determine whether this is making the current entity a collection, or if this is just a normal collection.
  if(!state.collectionProperty || pluralize(state.collectionProperty.trim(), 1).toLowerCase() === resolveName(state.entityId).toLowerCase()) {
    // this is turning the current entity into a collection
    chain = dispatch("submit list tile", {cardId: state.key, attribute: "is a", entityId: state.entityId, reverseEntityAndValue: true});
  } else {
    chain = dispatch("submit list tile", {cardId: state.key, attribute: state.collectionProperty, entityId: state.entityId, reverseEntityAndValue: false});
  }
  state.collectionProperty = undefined;
  chain.dispatch("toggle add tile", {key: state.key}).commit();
  console.log(JSON.stringify(state));
}

function imageAdderUI(elem) {
  let {entityId, key} = elem;
  let state = _state.widget.card[key] || {};
  return {c: "property-adder image-adder", children: [
    {children: [
      {c: "tile small", children: [
        {c: "tile-content-wrapper", children: [
          {t: "input", c: "value", placeholder: "image url", value: state.imageValue, attribute: "imageValue", input: trackPropertyAdderInput, postRender: autosizeAndFocus, keydown: adderKeys, entityId, key},
        ]},
        {c: "controls flex-row", children: [
          {c: "ion-checkmark submit", click: submitAdder, key},
          {c: "ion-close cancel", click: setTileAdder, key},
        ]}
      ]}
    ]}
  ]};
}

function submitImage(adder, state, node) {
  let chain = dispatch("add sourced eav", {entity: state.entityId, attribute: "image", value: `"${state.imageValue}"`});
  state.imageValue = undefined;
  chain.dispatch("toggle add tile", {key: state.key}).commit();
}


function comingSoonAdderUI(elem) {
  let {entityId, key} = elem;
  let state = _state.widget.card[key] || {};
  return {c: "property-adder", children: [
    {children: [
      {c: "tile small", children: [
        {c: "tile-content-wrapper", children: [
          {text: "This tile type is coming soon."}
        ]},
        {c: "controls flex-row", children: [
          {c: "ion-close cancel", click: setTileAdder, key},
        ]}
      ]}
    ]}
  ]};
}

export function tileAdder(elem) {
  let {entityId, key} = elem;
  let state = _state.widget.card[key] || {};
  let rows = [];
  let klass = "";
  if(!state.adder) {
    let adders = [
      {name: "Property", icon: "ion-compose", ui: propertyAdderUI, submit: submitProperty},
      {name: "Description", icon: "ion-drag", ui: descriptionAdderUI, submit: submitDescription},
      {name: "Collection", klass: "collection", icon: "ion-ios-list-outline", ui: collectionAdderUI, submit: submitCollection},
      {name: "Image", icon: "ion-image", ui: imageAdderUI, submit: submitImage},
      {name: "Document", icon: "ion-document", ui: comingSoonAdderUI},
      {name: "Computed", icon: "ion-calculator", ui: comingSoonAdderUI},
    ];
    let count = 0;
    let curRow = {c: "row flex-row", children: []};
    for(let adder of adders) {
      curRow.children.push({c: "tile small", adder, key, click: setTileAdder, children: [
        {c: "tile-content-wrapper", children: [
          {c: "property", text: adder.name},
          {c: `value ${adder.icon}`},
        ]}
      ]});
      count++;
      if(curRow.children.length === 3 || count === adders.length) {
        rows.push(curRow);
        curRow = {c: "row flex-row", children: []};
      }
    }
  } else {
    let adderElem = {entityId, key};
    if(state.adder.ui) {
      rows.push(state.adder.ui(adderElem));
    }
    klass = state.adder.klass || "";
  }
  return {c: `tile-adder ${klass}`, children: rows};
}

export function pageEditor(entityId:string, paneId:string, elem):Element {
  let {content = undefined} = eve.findOne("entity", {entity: entityId}) || {};
  let page = eve.findOne("entity page", {entity: entityId})["page"];
  let name = resolveName(entityId);
  elem.c = `wiki-editor ${elem.c || ""}`;
  elem.meta = {entityId: entityId, page, paneId};
  elem.options.noFocus = true;
  elem.value = content;
  elem.children = elem.cellItems;
  return elem;
}

//------------------------------------------------------------------------------
// Representations for Errors
//------------------------------------------------------------------------------

export function error(elem):Element {
  elem.c = `error-rep ${elem.c || ""}`;
  return elem;
}

//------------------------------------------------------------------------------
// Representations for Entities
//------------------------------------------------------------------------------
interface EntityElem extends Element { entity: string, data?: any }

export function name(elem:EntityElem):Element {
  let {entity} = elem;
  let {name = entity} = eve.findOne("display name", {id: entity}) || {};
  elem.text = name;
  elem.c = `entity ${elem.c || ""}`;
  return elem;
}

interface LinkElem extends EntityElem { nameAsChild?:boolean }
export function link(elem:LinkElem):Element {
  let {entity} = elem;
  let name = resolveName(entity);
  elem.c = `${elem.c || ""} entity link inline`;
  if(!elem["nameAsChild"]) {
    elem.text = elem.text || name;
  } else {
    elem.children = [{text: elem.text || name}];
  }
  elem["link"] = elem["link"] || entity;
  elem.click = elem.click || navigate;
  elem["peek"] = elem["peek"] !== undefined ? elem["peek"] : true;
  return elem;
}

export function attributes(elem:EntityElem):Element {
  let {entity} = elem;
  let attributes = [];
  for(let eav of eve.find("entity eavs", {entity})) attributes.push({attribute: eav.attribute, value: eav.value});
  attributes.sort((a, b) => {
      if(a.attribute === b.attribute) return 0;
      else if(a.attribute < b.attribute) return -1;
      return 1;
  })
  elem["groups"] = ["attribute"];
  elem["rows"] = attributes;
  elem["editCell"] = updateEntityValue;
  elem["editRow"] = updateEntityAttributes;
  elem["noHeader"] = true;
  return table(<any>elem);
}

export function related(elem:EntityElem):Element {
  let {entity, data = undefined} = elem;
  let name = resolveName(entity);
  let relations = [];
  for(let link of eve.find("directionless links", {entity})) relations.push(link.link);
  elem.c = elem.c !== undefined ? elem.c : "flex-row flex-wrap csv";
  if(relations.length) {
    elem.children = [{t: "h2", text: `${name} is related to ${relations.length} ${pluralize("entities", relations.length)}:`}];
    for(let rel of relations) elem.children.push(link({entity: rel, data}));

  } else elem.text = `${name} is not related to any other entities.`;
  return elem;
}

export function index(elem:EntityElem):Element {
  let {entity} = elem;
  let name = resolveName(entity);
  let facts = eve.find("is a attributes", {collection: entity});
  let list = {t: "ul", children: []};
  for(let fact of facts) list.children.push(link({t: "li", entity: fact.entity, data: elem.data}));
  
  elem.children = [
    {t: "h2", text: `There ${pluralize("are", facts.length)} ${facts.length} ${pluralize(name, facts.length)}:`},
    list
  ];
  return elem;
}

export function view(elem:EntityElem):Element {
  let {entity} = elem;
  let name = resolveName(entity);
  // @TODO: Check if given entity is a view, or render an error
  
  let rows = eve.find(entity);
  elem["rows"] = rows;
  return table(<any>elem);
}

export function results(elem:EntityElem):Element {
  let {entity, data = undefined} = elem;
  elem.children = [name({entity, data})];
  for(let eav of eve.find("entity eavs", {entity, attribute: "artifact"})) {
    elem.children.push(
      name({t: "h3", entity: eav.value, data}),
      view({entity: eav.value, data})
    );
  }
  return elem;
}

//------------------------------------------------------------------------------
// Representations for values
//------------------------------------------------------------------------------
function toggleEditValue(event, elem) {
   if(!elem.state) {
    console.warn("Cannot edit value without state");
    return;
  }
  elem.state.editing = elem.open !== undefined ? elem.open : !elem.state.editing;

  let chain = dispatch("rerender");
  if(elem.state.editing) {
    closePopup(event, elem, chain);
  }
  chain.commit();
}

function openEditValue(event, elem) {
  elem.open = true;
  toggleEditValue(event, elem);
  delete elem.open;
}
function closeEditValue(event, elem) {
  elem.open = false;
  toggleEditValue(event, elem);
  delete elem.open;
}

interface ValueElem extends Element { value: any, autolink?: boolean }
export function value(elem:ValueElem):Element {
  let {value, autolink = true, data} = elem;
  elem["original"] = value;
  let entity = asEntity(value);
  elem.text = value;
  if(entity) {
    elem["entity"] = entity;
    let name = resolveName(entity);
    elem.text = name;
    if(autolink) {
      link(<any>elem);
    }
  }
  
  return elem;
}

interface ValueEditorElem extends ValueElem { original?: string, disabled?:boolean, state?:{editing?: boolean} }
export function valueEditor(elem:ValueEditorElem) {
  elem.c = `flex-row cell ${elem.c || ""}`;
  let {state, disabled = false, data} = elem;
  if(elem.original === undefined) elem.original = elem.value;
  let content = value({value: elem.value, autolink: elem.autolink, data});
  let input;
  
  if(!disabled) {
    let _focus = elem.focus;
    let focus = (event, inputElem) => {
      if(_focus) _focus(event, elem);
      openEditValue(event, elem);
    };
    let _blur = elem.blur;
    let blur = (event, inputElem) => {
      if(_blur) _blur(event, elem);
      closeEditValue(event, elem);
    };
    
    input = {t: "input", focus, blur, value: "", strictText: true, placeholder: ""};
    if(!elem.value || state.editing) {
      input.placeholder = "<empty>";
    }
  
    if(state.editing) {
      ["input", "change", "keyup", "keydown"].map((handler) => {
        if(!elem[handler]) return;
        let _handle = elem[handler];
        input[handler] = (event, inputElem) => {
          _handle(event, elem);
        }
        delete elem[handler];
      });
      
      
      input.value = content.text;
      content = undefined;
    }
  }
  
  elem.children = [{c: "cell-content", children: [content]}, {c: "flex-grow cell-input", children: [input]}];
  return elem;
}

interface CSVElem extends Element { values: any[], autolink?: boolean }
export function CSV(elem:CSVElem):Element {
  let {values, autolink = undefined, data} = elem;
  return {c: "flex-row csv", children: values.map((val) => value({t: "span", autolink, value: val, data}))};
}

export function result(elem:CSVElem) {
  elem.c = "result";
  elem.children = [
    elem["search"] ? {c: "header", children: [{text: elem["search"]}]} : undefined,
    CSV(copy(elem))
  ];
  return elem;
}

interface CellEdit { field: string, prev: any, row:{}, value: any }
interface CellState { [field:string]: {editing?: boolean} }
interface TableState { sortField?:string, sortDirection?:number, adders?:{}[], changes?: CellEdit[], cellStates?:CellState[], adderCellStates?:CellState[] }
interface TableFieldElem extends Element {field:string, header:TableHeaderElem, state:TableState, sortable?:boolean}
interface TableCellElem extends Element { table:MappedTableElem, field:string, row:{}, text:string, editable?:boolean }
interface TableHeaderElem extends Element { state:TableState, fields:string[], groups?:string[], sortable?:boolean, addField?: Handler<Event>, removeField?: Handler<Event> }
interface TableBodyElem extends Element { state:TableState, rows:{}[], overrides?: CellEdit[], fields:string[], disabled?:string[], groups?:string[], sortable?:boolean, data?:{}, editCell?:Handler<Event>, editGroup?:Handler<Event>, removeRow?:Handler<Event> }
interface TableAdderElem extends Element {row:{}, fields: string[], disabled?: string[], confirm?:boolean, editCell?:Handler<Event>, submit?:Handler<Event> }
export function tableBody(elem:TableBodyElem):Element {
  let {state, rows, overrides = [], fields, data, groups = []} = elem;
  fields = fields.slice();
  if(!rows.length) {
    elem.text = "<Empty Table>";
    return elem;
  }

  let disabled = {};
  for(let field of elem.disabled || []) {
    disabled[field] = true;
  }

  // Strip grouped fields out of display fields -- the former implies the latter and must be handled first
  for(let field of groups) {
    let fieldIx = fields.indexOf(field);
    if(fieldIx !== -1) {
      fields.splice(fieldIx, 1);
    }
  }

  // Manage interactivity
  let {sortable = false, editCell, editGroup, removeRow} = elem;
  if(editCell) {
    if(!state.cellStates) state.cellStates = [];
    
    let _editCell = editCell;
    editCell = (event:Event, elem) => {
      let val = resolveValue(getNodeContent(<HTMLElement>event.target));
      if(val === elem["original"]) return;
      _editCell(new CustomEvent("editcell", {detail: val}), elem);
    }
    let _editGroup = editGroup;
    editGroup = (event:Event, elem) => {
      let val = resolveValue(getNodeContent(<HTMLElement>event.target));
      if(val === elem["original"]) return;
      if(_editGroup) _editGroup(new CustomEvent("editgroup", {detail: val}), elem);
      else {
        for(let row of elem.rows) {
          _editCell(new CustomEvent("editcell", {detail: val}), elem);
        }
      }
    };
  }

  // Sort rows
  if(state.sortField && state.sortDirection) {
    rows.sort(sortByFieldValue(state.sortField, state.sortDirection));
  }
  for(var field of groups) {
    rows.sort(sortByFieldValue(field, field === state.sortField ? state.sortDirection : 1));
  }

  elem.children = [];
  let body = elem;
  let openRows = {};
  let openVals = {};
  let rowIx = 0;
  for(let row of rows) {
    let override = {};
    for(let change of overrides) {
      if(change.row === row) {
        override[change.field] = change.value;
      }
    }
    
    if(editCell && !state.cellStates[rowIx]) {
      state.cellStates[rowIx] = {};
    }
    
    let group;
    for(let field of groups) {
      let val = (field in override ? override[field] : row[field]) || "";
      if(editCell && !state.cellStates[rowIx][field]) {
        state.cellStates[rowIx][field] = {};
      }
      let cellState = editCell && state.cellStates[rowIx][field];
      
      if(openVals[field] === val) { // The row is still contained within this group
        group = openRows[field];
        group.children[0].rows.push(row);
      } else { // The row begins a new group at current level in the hierarchy
        openVals[field] = val;
        let cur = openRows[field] = {
          c: "table-row grouped",
          children: [
            valueEditor({
              c: "column cell",
              value: val,
              state: cellState,
              data,
              table: elem,
              field,
              rows: [row],
              disabled: !editGroup || disabled[field],
              keydown: blurOnEnter,
              blur: editGroup
            }),
            {c: "flex-column flex-grow group", children: []}
          ]
        };
        if(group) {
          group.children[1].children.push(cur);
        } else {
          body.children.push(cur);
        }
        group = cur;
      }
    }

    let rowItem = {c: "table-row", children: []};
    for(let field of fields) {
      let val = (field in override ? override[field] : row[field]) || "";
      if(editCell && !state.cellStates[rowIx][field]) {
        state.cellStates[rowIx][field] = {};
      }
      let cellState = editCell && state.cellStates[rowIx][field];

      rowItem.children.push(valueEditor({
        c: "column cell",
        value: val,
        state: cellState,
        data,
        table: elem,
        field,
        row,
        disabled: !editCell || disabled[field],
        keydown: blurOnEnter,
        blur: editCell
      }));
    }

    rowItem.children.push({c: "controls", children: [
      removeRow ? {c: "ion-icon-android-close", row: rowItem, click: removeRow} : undefined
    ]});

    if(group) {
      group.children[1].children.push(rowItem);
    } else {
      body.children.push(rowItem);
    }
    rowIx++;
  }

  elem.c = `table-body ${elem.c || ""}`;
  return {c: "table-body-scroller", children: [elem]};
}

function tableHeader(elem:TableHeaderElem):Element {
  let {state, fields, groups = [], sortable = false, data} = elem;
  fields = fields.slice();
  // Strip grouped fields out of display fields -- the former implies the latter and must be handled first
  for(let field of groups) {
    let fieldIx = fields.indexOf(field);
    if(fieldIx !== -1) {
      fields.splice(fieldIx, 1);
    }
  }

  let {addField, removeField} = elem;

  // Build header
  elem.t = "header";
  elem.c = `table-header ${elem.c || ""}`;
  elem.children = [];
  for(let field of groups.concat(fields)) {
    let isActive = field === state.sortField;
    let direction = isActive ? state.sortDirection : 0;
    let klass = `sort-toggle ${isActive && direction < 0 ? "ion-arrow-up-b" : "ion-arrow-down-b"} ${isActive ? "active" : ""}`;
    elem.children.push({c: "column field", children: [
      value({c: "text", value: field, data, autolink: false}),
      {c: "flex-grow"},
      {c: "controls", children: [
        sortable ? {c: klass, table: elem, field, direction: -direction || 1, click: sortTable} : undefined,
        removeField ? {c: "ion-close-round", table: elem, field, click: removeField} : undefined
      ]}
    ]});
  };
  elem.children.push({c: "controls", children: [
    addField ? {c: "ion-plus-round add-field-btn", table: elem, click: addField} : undefined
  ]});
  return elem;
}

export function tableAdderRow(elem:TableAdderElem):Element {
  let {row, cellStates, fields, confirm = true, editCell, submit, data} = elem;
  elem.c = `table-row table-adder ${elem.c || ""}`;
  elem.children = [];
  let disabled = {};
  for(let field of elem.disabled || []) {
    disabled[field] = true;
  }

  // By default, accept all changes
  if(!editCell) {
    editCell = (event, cellElem:TableCellElem) => {
      row[cellElem.field] = resolveValue(getNodeContent(<HTMLElement>event.target));
    };
  }

  // Wrap submission to point at the adder element instead of the add button
  if(submit) {
    let _submit = submit;
    submit = (event, _) => _submit(event, elem);
  }

  // If we should add without confirmation, submit whenever the row is completely filled in
  if(!confirm && submit) {
    let _editCell = editCell;
    editCell = (event, cellElem:TableCellElem) => {
      let valid = !_editCell(event, cellElem);
      for(let field of fields) {
        if(row[field] === undefined) valid = false;
      }
      if(valid) submit(event, elem);
    }
  }

  for(let field of fields) {
    if(!cellStates[field]) {
      cellStates[field] = {};
    }
    elem.children.push(valueEditor({
      c: `column cell ${disabled[field] ? "disabled" : ""}`,
      disabled: disabled[field],
      value: row[field] || "",
      state: cellStates[field],
      data,
      table: elem,
      field,
      row,
      keydown: blurOnEnter,
      blur: editCell
    }));
  }

  if(confirm) {
    elem.children.push({c: "controls", children: [{c: "confirm-row ion-checkmark-round", table: elem, row, click: submit}]});
  }

  return elem;
}

function createFact(chain, row:{}, {subject, entity, fieldMap, collections}:{subject:string, entity?:string, fieldMap:{[field:string]: string}, collections?: string[]}) {
  let name = row[subject];
  if(!entity) {
    entity = asEntity(name);
  }
  
  if(!entity) {
    entity = uuid();
    let pageId = uuid();
    console.log(" - creating entity", entity);
    chain.dispatch("create page", {page: pageId,  content: ""})
      .dispatch("create entity", {entity, name, page: pageId});
  }
      
  for(let field in fieldMap) {
    let value = resolveValue(row[field]);
    console.log(" - adding attr", fieldMap[field], "=", value, "for", entity);
    
    if(value[0] === "\"" && value[value.length - 1] === "\"") {
      value = value.slice(1, -1);
    } else if(typeof value === "string") {
      if(!isEntity(value)) {
        let pageId = uuid();
        let entity = uuid();
        let name = value;
        value = entity;
        console.log("   - creating entity", entity);
        chain.dispatch("create page", {page: pageId,  content: ""})
          .dispatch("create entity", {entity, name, page: pageId});
      }
    }
    
    chain.dispatch("add sourced eav", {entity, attribute: fieldMap[field], value});
  }

  if(collections) {
    for(let coll of collections) {
      console.log(" - adding coll", "is a", "=", coll, "for", entity);
      chain.dispatch("add sourced eav", {entity, attribute: "is a", value: coll});
    }
  }
}

function tableStateValid(tableElem:MappedTableElem) {
  let {state, fields, groups = []} = tableElem;
  // A new adder is added every time the previous adder was changes, so the last one is empty.
  let adders = state.adders.slice(0, -1);
  
  // Ensure all batched changes are valid before committing any of them.
  for(let adder of adders) {
    for(let field of fields.concat(groups)) {
      if(adder[field] === undefined || adder[field] === "") return false;
    }
  }

  for(let change of state.changes) {
    if(change.value === undefined || change.value === "") return false;
  }
  
  return true;
}

function manageAdders(state, row, field) {
  if(row[field] !== undefined && row[field] !== "") {
    if(row === state.adders[state.adders.length - 1]) {
      // We added a value to the blank adder and need to push a new adder
      state.adders.push({});
    }
  } else {
    let ix = 0;
    while(ix < state.adders.length - 1) {
      let adder = state.adders[ix];
      let gc = true;
      for(let field in adder) {
        if(adder[field] !== undefined && adder[field] !== "") {
          gc = false;
          break;
        }
      }
      if(gc) {
        state.adders.splice(ix, 1);
      } else {
        ix++;
      }
    }
  }
}

function changeAttributeAdder(event, elem) {
  let {table:tableElem, row, field} = elem;
  let {state} = tableElem;
  row[field] = resolveValue(getNodeContent(event.target));
  manageAdders(state, row, field);
  dispatch("rerender").commit();
}

function changeEntityAdder(event, elem) {
  let {table:tableElem, row, field} = elem;
  let {state, subject, fieldMap} = tableElem;
  row[field] = resolveValue(getNodeContent(event.target));
  if(field === subject) {
    // @NOTE: Should this really be done by inserting "= " when the input is focused?
    let entityId = asEntity(resolveValue(row[subject]));
    if(entityId) {
      for(let field in fieldMap) {
        let {value = undefined} = eve.findOne("entity eavs", {entity: entityId, attribute: fieldMap[field]}) || {};
        if(!row[field] && value !== undefined) {
          row[field] = value;
        }
      }
    }
  }
  manageAdders(state, row, field);
  dispatch("rerender").commit();
}

function updateRowAttribute(event, elem:TableCellElem) {
  let {field, row, table:tableElem} = elem;
  let {state, subject, fieldMap} = tableElem;
  let value = resolveValue(event.detail);
  let change;
  for(let cur of state.changes) {
    if(cur.field === field && cur.row === row) {
      change = cur;
      break;
    }
  }
  if(!change) {
    change = {field, prev: row[field], row, value};
    state.changes.push(change);
  } else {
    change.value = value;
  }
  dispatch("rerender").commit();
}

function commitChanges(event, elem:{table:MappedTableElem}) {
  // @TODO: Batch changes to existing rows in editCell into state.changes[]
  // @TODO: Submit all batched cell changes
  // @TODO: Update resolveValue to use new string semantics
  let {table:tableElem} = elem;
  let {subject, fieldMap, state} = tableElem;
  let chain:any = dispatch("rerender");

  // A new adder is added every time the previous adder was changes, so the last one is empty.
  let adders = state.adders.slice(0, -1);
  
  if(tableStateValid(tableElem)) {
    for(let adder of adders) {
      createFact(chain, adder, tableElem);
    }

    for(let {field, prev, row, value} of state.changes) {
      let entity = row[subject];
      dispatch("update entity attribute", {entity, attribute: fieldMap[field], prev, value}).commit();
    }

    state.adders = [{}];
    state.changes = [];
    chain.commit();
  } else {
    console.warn("One or more changes is invalid, so all changes have not been committed");
  }
}

function commitChangesOnEnter(event:KeyboardEvent, elem:MappedTableElem) {
  if(event.keyCode === KEYS.ENTER) {
    let target = <HTMLElement>event.target;
    if(target && target.blur) {
      target.blur();
    }
    commitChanges(event, {table: elem});
  }
}

interface TableElem extends TableBodyElem { search?: string }
export function table(elem:TableElem):Element {
  let {state, rows, fields, groups, disabled, sortable, editCell, data} = elem;
  elem.c = `table-wrapper table ${elem.c || ""}`;
  elem.children = [
    elem.search ? {t: "h2", text: elem.search} : undefined,
    tableHeader({state, fields, groups, sortable, data}),
    tableBody({rows, state, fields, groups, disabled, sortable, editCell, data})
  ];

  return elem;
}
// @TODO: Choose MappedTable or Table when baking search pane
interface MappedTableElem extends TableElem { entity?: string, subject: string, fieldMap: {[field:string]: string}, collections?:string[] }
export function mappedTable(elem:MappedTableElem):Element {
  let {state, entity, subject, fieldMap, collections, data} = elem;
  // If we're mapped to an entity search we can only add new attributes to that entity
  for(let adder of state.adders) {
    if(entity && adder[subject] !== entity) {
      adder[subject] = entity;
    }
  }
  if(!state.adderCellStates) {
    state.adderCellStates = [];
  }
  if(state.adders.length !== state.adderCellStates.length) {
    if(state.adders.length > state.adderCellStates.length) {
      for(let ix = 0; ix = state.adders.length - state.adderCellStates.length; ix++) {
        state.adderCellStates.push({});
      }
    } else {
      state.adderCellStates.splice(state.adders.length, state.adderCellStates.length);
    }
  }

  let {rows, fields, groups, disabled = [subject], sortable = true} = elem;
  let adderChanged = entity ? changeAttributeAdder : changeEntityAdder;
  let adderDisabled = entity ? [subject] : undefined;
  let stateValid = tableStateValid(elem);

  elem.c = `table-wrapper mapped-table ${elem.c || ""}`;
  elem.keydown = commitChangesOnEnter;
  elem.children = [
    elem.search ? {t: "h2", text: elem.search} : undefined,
    tableHeader({state, fields, groups, sortable, data}),
    tableBody({rows, overrides: state.changes, state, fields, groups, disabled, sortable, subject, fieldMap, editCell: updateRowAttribute, data}),
    {c: "table-adders", children: state.adders.map((row, ix) => tableAdderRow({
      row,
      state,
      cellStates: state.adderCellStates[ix],
      fields,
      disabled: adderDisabled,
      confirm: false,
      subject,
      fieldMap,
      collections,
      data,
      editCell: adderChanged
    }))},
    {c: `ion-checkmark-round commit-btn ${stateValid ? "valid" : "invalid"}`, table: elem, click: stateValid && commitChanges}
  ];
  
  return elem;
}

interface TableFilterElem extends Element { key: string, sortFields?: string[], search?: (search:string) => string[]|Element[] }
export function tableFilter(elem:TableFilterElem) {
  let {key, search = undefined, sortFields = undefined} = elem;
  elem.children = [];
  if(sortFields) {
    let state = _state.widget.table[key] || {sortField: undefined, sortDirection: undefined};
    let sortOpts = [];
    for(let field of sortFields) {
      sortOpts.push({t: "option", text: resolveName(field), value: field, selected: field === state.sortField});
    }
    elem.children.push({c: "flex-grow"});
    elem.children.push({c: "sort", children: [
      {text: "Sort by"},
      {t: "select", c: "select-sort-field select", value: state.sortField, children: sortOpts, key, change: sortTable},
      {c: `toggle-sort-dir ${state.sortDirection === -1 ? "ion-arrow-up-b" : "ion-arrow-down-b"}`, key, direction: -state.sortDirection || 1, click: sortTable},
    ]});
  }
  elem.c = `table-filter ${elem.c || ""}`;
  return elem;
}

interface URLElem extends Element { url: string }
export function externalLink(elem:URLElem) {
  elem.t = "a";
  elem.c = `link ${elem.c || ""}`;
  elem.href = elem.url;
  elem.text = elem.text || elem.url;
  return elem;
}

export function externalImage(elem:URLElem) {
  elem.t = "img";
  elem.c = `img ${elem.c || ""}`;
  elem.src = elem.url;
  return elem;
}

export function externalVideo(elem:URLElem) {
  let ext = elem.url.slice(elem.url.lastIndexOf(".")).trim().toLowerCase();
  let domain = elem.url.slice(elem.url.indexOf("//") + 2).split("/")[0];
  let isFile = ["mp4", "ogv", "webm", "mov", "avi", "flv"].indexOf(ext) !== -1;
  if(isFile) {
    elem.t = "video";
  } else {
    elem.t = "iframe";
  }
  elem.c = `video ${elem.c || ""}`;
  elem.src = elem.url;
  elem.allowfullscreen = true;
  return elem;
}

//------------------------------------------------------------------------------
// Containers
//------------------------------------------------------------------------------
interface CollapsibleElem extends Element { key:string, header?:Element, open?:boolean }
export function collapsible(elem:CollapsibleElem):Element {
  if(elem.key === undefined) throw new Error("Must specify a key to maintain collapsible state");
  let state = _state.widget.collapsible[elem.key] || {open: elem.open !== undefined ? elem.open : true};
  let content = {children: elem.children};
  let header = {t: "header", children: [{c: "collapse-toggle " + (state.open ? "ion-chevron-up" : "ion-chevron-down"), collapsible: elem.key, open: state.open, click: toggleCollapse}, elem.header]};

  elem.c = `collapsible ${elem.c || ""}`;
  elem.children = [header, state.open ? content : undefined];
  return elem;
}

function toggleCollapse(evt, elem) {
  dispatch("toggle collapse", {collapsible: elem.collapsible, open: !elem.open});
}

let directoryTileLayouts:MasonryLayout[] = [
  {size: 4, c: "big", format(elem) {
    // elem.children.unshift
    elem.children.push(
      // {text: `(${elem["stats"][elem["stats"].best]} ${elem["stats"].best})`}
    );
    return elem;
  }},
  {size: 2, c: "detailed", format(elem) {
    elem.children.push(
      // {text: `(${elem["stats"][elem["stats"].best]} ${elem["stats"].best})`}
    );
    return elem;
  }},
  {size: 1, c: "normal", grouped: 2}
];
let directoryTileStyles = ["tile-style-1", "tile-style-2", "tile-style-3", "tile-style-4", "tile-style-5", "tile-style-6", "tile-style-7"];

// @TODO: Clean up directory elem
interface DirectoryElem extends Element { entities:string[], data?:any }
export function directory(elem:DirectoryElem):Element {
  let key = "directory|home"; // @TODO: FIXME
  
  const MAX_ENTITIES_BEFORE_OVERFLOW = 14;
  let {entities:rawEntities, data = undefined} = elem;
  let {systems, collections, entities, scores, relatedCounts, wordCounts, childCounts} = classifyEntities(rawEntities);
  let sortByScores = sortByLookup(scores);
  entities.sort(sortByScores);
  collections.sort(sortByScores);
  systems.sort(sortByScores);

  let collectionTableState = _state.widget.table[`${key}|collections table`] || {sortField: "score", sortDirection: -1, adders: []};
  _state.widget.table[`${key}|collections table`] = collectionTableState;
  let entityTableState = _state.widget.table[`${key}|entities table`] || {sortField: "score", sortDirection: -1, adders: []};
  _state.widget.table[`${key}|entities table`] = entityTableState;
  
  // Link to entity
  // Peek with most significant statistic (e.g. 13 related; or 14 childrenpages; or 5000 words)
  // Slider pane will all statistics
  // Click opens popup preview

  function getStats(entity) {
    let stats = {name: entity, best:"", links: relatedCounts[entity], pages: childCounts[entity], words: wordCounts[entity]};
    let maxContribution = 0;
    for(let stat in stats) {
      if(!statWeights[stat]) continue;
      let contribution = stats[stat] * statWeights[stat];
      if(contribution > maxContribution) {
        maxContribution = contribution;
        stats.best = stat;
      }
    }
    return stats;
  }
  
  function formatTile(entity) {
    let stats = getStats(entity);
    return {size: scores[entity], stats, children: [
      link({entity, data, nameAsChild: true})
    ]};
  }

  function formatList(name:string, entities:string[], state) {
    let sortOpts = [];
    for(let field of ["score", "links", "words"]) {
      sortOpts.push({t: "option", text: resolveName(field), value: field, selected: field === state.sortField});
    }

    return {c: "directory-list flex-grow flex-row", children: [
      collapsible({c: "flex-grow", key: `${key}|${name} collapsible`, header: {text: `Show all ${name}`}, open: false, children: [
        {c: "flex-row", children: [
          {c: "table-wrapper", children: [
            tableBody({rows: entities.map(getStats), fields: ["name"].concat([state.sortField] || []), sortable: false, state, data}),
          ]},
          {t: "select", c: "select-sort-field select", value: state.sortField, table: {state}, children: sortOpts, change: sortTable},
        ]}
      ]})
    ]};
  }

  collections = collections.filter((coll) => asEntity("test data") !== coll);
  let highlights = collections.slice(0, 4).concat(entities.slice(0, 4));
  return {c: "directory flex-column", children: [
    {c: "header", children: [
      {text: "Home"},
    ]},
    {c: "tile-scroll", children: [
      {c: "tiles", children: [
        {c: "row flex-row", children: [
          {c: "tile full", children: [
            {c: "tile-content-wrapper", children: [
              {c: "value text", children: [
                {text: "Welcome to Eve! Here are some of the cards currently in the system:"}
              ]}
            // @TODO: body copy.
            ]}
          ]},
        ]},
        {c: "row flex-row", children: [
          masonry({c: "directory-highlights", rowSize: 6, layouts: directoryTileLayouts, styles: directoryTileStyles, children: highlights.map(formatTile)}),
        ]}
      ]}
    ]}
    // {c: "directory-lists flex-row", children: [
    //   formatList("collections", collections, collectionTableState),
    //   formatList("entities", entities, entityTableState)
    // ]}
  ]};
}

export var masonry = masonryRaw;

