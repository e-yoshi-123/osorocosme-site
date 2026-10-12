// 画像が読み込めないときの共通の処理（135章）。Layout.astro の <head> で、本文より先に読み込む（273章で全ページへの埋め込みから外へ出した）。
// 画像の error はバブルしないので、キャプチャで拾う。
window.addEventListener("error", function (ev) {
  var img = ev.target;
  if (!img || img.tagName !== "IMG") return;
  // 部品ごとの処理（以前は画像ごとに onerror="…" を書いていた。容量を減らすため data-err にまとめた。273章）
  var mode = img.getAttribute("data-err");
  if (mode) {
    if (mode === "hide") img.style.visibility = "hidden";
    else if (mode === "remove") img.remove();
    else if (mode === "remove-parent") { if (img.parentElement) img.parentElement.remove(); }
    else {
      var li = mode === "noimg-row" ? img.closest("li") : null;
      var n = document.createElement("span");
      n.className = "noimg"; n.textContent = "No image";
      img.replaceWith(n);
      if (li) li.querySelectorAll("[data-buy]").forEach(function (e) { e.remove(); });
    }
    return;
  }
  if (img.hasAttribute("onerror") || img.closest("[data-item-image]")) return;
  // チャンネルアイコン：YouTube側が短時間の多数の読み込みを断ることがある（192章のあとの見直し）。
  // 少し待って1回だけ読み直し、それでも駄目なら同じ大きさの丸に名前の頭文字を出す
  if (/yt3\.ggpht\.com|googleusercontent\.com/.test(img.src)) {
    if (!img.dataset.retried) {
      img.dataset.retried = "1";
      var src = img.src;
      setTimeout(function () { img.src = src + (src.indexOf("?") < 0 ? "?" : "&") + "r=1"; }, 400 + Math.random() * 1200);
      return;
    }
    var link = img.closest("a");
    var name = (img.alt || img.dataset.name || (link && link.getAttribute("title")) || "").trim();
    var m = document.createElement("span");
    m.className = img.className + " avatar-fallback";
    m.setAttribute("aria-hidden", "true");
    m.textContent = name ? Array.from(name)[0].toUpperCase() : "";
    var w = img.getBoundingClientRect().width;
    if (w) m.style.fontSize = Math.max(10, Math.round(w * 0.42)) + "px";
    img.replaceWith(m);
    return;
  }
  if (!/thumbnail\.image\.rakuten\.co\.jp|item-shopping\.c\.yimg\.jp/.test(img.src)) return;
  var box = img.closest("[data-yahoo-image]");
  if (box && !box.hasAttribute("data-swapped")) {
    box.setAttribute("data-swapped", "");
    var a = document.createElement("a");
    a.href = box.getAttribute("data-yahoo-link"); a.target = "_blank"; a.rel = "nofollow sponsored noopener";
    var y = document.createElement("img");
    y.src = box.getAttribute("data-yahoo-image"); y.alt = img.alt; y.loading = "lazy";
    a.appendChild(y); box.replaceChildren(a);
    return;
  }
  var s = document.createElement("span");
  s.className = "noimg"; s.textContent = "No image";
  (img.parentElement && img.parentElement.tagName === "A" && img.parentElement.children.length === 1 ? img.parentElement : img).replaceWith(s);
}, true);

// YouTubeのサムネイル（lib/data.ts の ytThumb）：sddefault はまれに無く、120×90 の灰色の画像が返るので、
// その場合は srcset を外して hqdefault に戻す（213章）。以前は画像ごとに onload="…" を書いていた（容量を減らすためここにまとめた。280章）
document.addEventListener("load", function (ev) {
  var img = ev.target;
  if (!img || img.tagName !== "IMG" || !img.srcset) return;
  if (img.naturalWidth < 200 && /^https:\/\/i\.ytimg\.com\//.test(img.currentSrc || img.src)) img.removeAttribute("srcset");
}, true);
