// ==UserScript==
// @name         人人钢琴网下载图片
// @namespace    https://www.everyonepiano.cn/
// @version      1.0.3
// @description  自动下载页面中第一张谱子预览图，并以图片地址末段命名
// @match        https://www.everyonepiano.cn/*
// @match        https://everyonepiano.cn/*
// @match        http://www.everyonepiano.cn/*
// @match        http://everyonepiano.cn/*
// @run-at       document-idle
// @grant        GM_download
// @connect      www.everyonepiano.cn
// @connect      everyonepiano.cn
// ==/UserScript==

(function () {
  "use strict";

  const targetImage = document.querySelector("img.img-responsive.DownMusicPNG");
  if (!(targetImage instanceof HTMLImageElement)) {
    console.info("[人人钢琴网下载图片] 页面中没有找到五线谱预览图。");
    return;
  }

  const runFlag = "__everyonePianoFirstScoreImageDownloadStarted__";
  if (window[runFlag]) return;

  const source = targetImage.getAttribute("src") || targetImage.currentSrc || targetImage.src;
  const imageUrl = new URL(source, document.baseURI);
  if (imageUrl.protocol !== "https:" && imageUrl.protocol !== "http:") {
    console.warn("[人人钢琴网下载图片] 图片地址协议不受支持。", imageUrl.href);
    return;
  }

  if (imageUrl.hostname !== "www.everyonepiano.cn" && imageUrl.hostname !== "everyonepiano.cn") {
    console.warn("[人人钢琴网下载图片] 图片地址不属于人人钢琴网。", imageUrl.href);
    return;
  }

  const encodedImageFilename = imageUrl.pathname.split("/").filter(Boolean).pop();
  let imageFilename = "人人钢琴网乐谱图片";
  if (encodedImageFilename) {
    try {
      imageFilename = decodeURIComponent(encodedImageFilename);
    } catch {
      imageFilename = encodedImageFilename;
    }
  }
  const imageExtension =
    imageUrl.pathname.match(/\.(png|jpe?g|webp|gif)$/i)?.[0].toLowerCase() || ".png";
  const filename = imageFilename.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_");
  const downloadFilename = `${filename}${imageExtension}`;

  window[runFlag] = true;
  GM_download({
    url: imageUrl.href,
    name: downloadFilename,
    saveAs: false,
    onload: () => console.info(`[人人钢琴网下载图片] 已下载：${downloadFilename}`),
    onerror: (error) => {
      delete window[runFlag];
      console.error("[人人钢琴网下载图片] 下载失败，可以重新运行脚本重试。", error);
    },
  });
})();
