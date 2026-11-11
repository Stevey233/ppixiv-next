// ==UserScript==
// @name        ppixiv 新界面
// @author      ppixiv, Stevey233
// @namespace   stevey-ppixiv-next
// @description 基于 ppixiv 的 Pixiv 看图脚本：简体中文界面、中文标签译名、筛选、看过标记、高清缩略图和重新设计的界面。不要和原版 ppixiv 或 ppixiv-zh 同时启用。
// @homepage    https://github.com/ppixiv/ppixiv
// @noframes
// @match       https://*.pixiv.net/*
// @run-at      document-start
// @icon        https://ppixiv.org/ppixiv.png
// @grant       GM.xmlHttpRequest
// @grant       GM.setValue
// @grant       GM.getValue
// @connect     pixiv.net
// @connect     pximg.net
// @connect     self
//
// @comment     Note: this doesn't actually give the script access everywhere.  It just lets us request
// @comment     access to new domains at runtime.  If you use a feature that needs access to another site,
// @comment     the script manager will ask for permission the first time.
// @connect     *
//
