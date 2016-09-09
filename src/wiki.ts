"use strict"

import * as app from "./app";
import * as bootstrap from "./bootstrap";
import * as ui from "./ui";
import {deslugify, location as getLocation} from "./utils";


app.renderRoots["wiki"] = ui.root;

// @HACK: we have to use bootstrap in some way to get it to actually be included and
// executed
var ixer = bootstrap.ixer;

function initSearches(eve) {
  for(let pane of eve.find("ui pane")) {
    if(eve.findOne("entity", {entity: pane.contains})) continue;
  }
}

app.init("wiki", function() {
  document.body.classList.add(localStorage["theme"] || "light");
  app.activeSearches = {};
  initSearches(app.eve);

  window.history.replaceState({root: true}, null, window.location.hash);
  let mainPane = app.eve.findOne("ui pane", {pane: "p1"});
  let path = getLocation();
  let [_, kind, raw = ""] = path.split("/");
  let content = deslugify(raw) || "home";
  let cur = app.dispatch("set pane", {paneId: mainPane.pane, contains: content});
  if(content && !app.eve.findOne("query to id", {query: content})) {
    cur.dispatch("insert query", {query: content});
  }
  cur.commit();
});

window.addEventListener("hashchange", function() {
  let mainPane = app.eve.findOne("ui pane", {pane: "p1"});
  let path = getLocation();
  let [_, kind, raw = ""] = path.split("/");
  let content = deslugify(raw) || "home";
  content = ui.asEntity(content) || content;

  if(mainPane.contains === content) return;

  let cur = app.dispatch("set pane", {paneId: mainPane.pane, contains: content});
  if(content && !app.eve.findOne("query to id", {query: content})) {
    cur.dispatch("insert query", {query: content});
  }
  cur.commit();
});
