/**
 * 設定視窗的分頁（三個遊戲共用）。事件委派：點 .uiTab[data-tab]，同一個視窗裡對應的 .uiPanel[data-panel] 才顯示。
 * 載入這個模組就生效，視窗是動態產生的也沒問題。
 */

const ROOTS = ".modalDialog, .sheetDialog, dialog.uiDialog";

export function showTab(root, name) {
  root.querySelectorAll(".uiTab[data-tab]").forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle("on", on);
    tab.setAttribute("aria-selected", String(on));
  });
  root.querySelectorAll(".uiPanel[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  root.querySelector(".modalBody, .sheetBody")?.scrollTo?.(0, 0);
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest?.(".uiTab[data-tab]");
  if (!tab || tab.closest("dialog.uiDialog")) return; // 規則視窗自己處理
  const root = tab.closest(ROOTS);
  if (root) showTab(root, tab.dataset.tab);
});
