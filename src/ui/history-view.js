/**
 * 📜 骰子黑白棋 (Dice Othello) - 棋譜歷程與分支樹檢視元件 (History & Branch View)
 */

import { tr, tx, pieceify } from "../i18n.js";

export class HistoryView {
  constructor({
    historyContainer,
    branchSelectEl,
    onJumpToNode,
    onOpenBranchModal,
    onStepFirst,
    onStepPrev,
    onStepNext,
    onStepLatest,
    onSwitchBranch
  }) {
    this.container = historyContainer;
    this.branchSelectEl = branchSelectEl; // kept for compat, unused
    this.onJumpToNode = onJumpToNode;
    this.onOpenBranchModal = onOpenBranchModal;
    this.onStepFirst = onStepFirst;
    this.onStepPrev = onStepPrev;
    this.onStepNext = onStepNext;
    this.onStepLatest = onStepLatest;
    this.onSwitchBranch = onSwitchBranch;

    this.firstBtn = document.getElementById("historyFirstBtn");
    this.prevBtn = document.getElementById("historyPrevBtn");
    this.nextBtn = document.getElementById("historyNextBtn");
    this.latestBtn = document.getElementById("historyLatestBtn");

    this.pickerBtn = document.getElementById("branchPickerBtn");
    this.pickerPanel = document.getElementById("branchPickerPanel");
    this.pickerLabel = document.getElementById("branchPickerLabel");
    this.treeRows = document.getElementById("branchTreeRows");

    this.nodes = [];
    this.currentNodeId = null;
    this._panelOpen = false;

    this.init();
  }

  init() {
    // 棋譜列表點擊跳轉
    if (this.container) {
      this.container.addEventListener("click", (e) => {
        const item = e.target.closest(".historyItem");
        if (item) {
          const nodeId = item.dataset.nodeId;
          if (this.onJumpToNode && nodeId) this.onJumpToNode(nodeId);
        }
      });
    }

    // 分支樹 picker 按鈕開關
    if (this.pickerBtn) {
      this.pickerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._togglePanel();
      });
    }

    // 分支樹列表點擊
    if (this.treeRows) {
      this.treeRows.addEventListener("click", (e) => {
        const row = e.target.closest(".branchTreeRow");
        if (!row) return;
        const branchId = row.dataset.branchId;
        if (branchId === "__MODAL__") {
          this._closePanel();
          if (this.onOpenBranchModal) this.onOpenBranchModal();
        } else if (branchId && this.onSwitchBranch) {
          this._closePanel();
          this.onSwitchBranch(branchId);
        }
      });
    }

    // 點選外部關閉
    document.addEventListener("click", () => this._closePanel());

    // 播放控制
    if (this.firstBtn && this.onStepFirst) this.firstBtn.addEventListener("click", () => this.onStepFirst());
    if (this.prevBtn && this.onStepPrev) this.prevBtn.addEventListener("click", () => this.onStepPrev());
    if (this.nextBtn && this.onStepNext) this.nextBtn.addEventListener("click", () => this.onStepNext());
    if (this.latestBtn && this.onStepLatest) this.latestBtn.addEventListener("click", () => this.onStepLatest());
  }

  _togglePanel() {
    this._panelOpen ? this._closePanel() : this._openPanel();
  }
  _openPanel() {
    this._panelOpen = true;
    if (this.pickerPanel) this.pickerPanel.hidden = false;
    if (this.pickerBtn) this.pickerBtn.setAttribute("aria-expanded", "true");
  }
  _closePanel() {
    this._panelOpen = false;
    if (this.pickerPanel) this.pickerPanel.hidden = true;
    if (this.pickerBtn) this.pickerBtn.setAttribute("aria-expanded", "false");
  }

  /** 遞迴建立分支樹 HTML（DFS） */
  _buildTreeHtml(gameTree, branchId, depth, isLast) {
    const branch = gameTree.branches.get(branchId);
    if (!branch) return "";

    const isActive = branchId === gameTree.activeBranchId;
    const children = [...gameTree.branches.values()]
      .filter(b => b.parentBranchId === branchId)
      .sort((a, b) => a.forkStepIdx - b.forkStepIdx);

    // 縮排前綴
    let prefix = "";
    if (depth > 0) {
      prefix = isLast ? "└─ " : "├─ ";
    }

    const label = tx(branch.name);
    let html = `<div class="branchTreeRow${isActive ? " active" : ""}" data-branch-id="${branchId}" style="--depth:${depth}">
      <span class="branchTreePrefix">${prefix}</span>
      <span class="branchTreeName">${label}</span>
      ${isActive ? '<span class="branchTreeCheck">✓</span>' : ""}
    </div>`;

    for (let i = 0; i < children.length; i++) {
      html += this._buildTreeHtml(gameTree, children[i].id, depth + 1, i === children.length - 1);
    }
    return html;
  }

  render({ gameTree, currentNodeId }) {
    this.currentNodeId = currentNodeId;
    const historyList = gameTree.getBranchHistory(gameTree.activeBranchId);
    this.nodes = historyList;

    // 1. 渲染分支樹 picker
    const activeBranch = gameTree.branches.get(gameTree.activeBranchId);
    if (this.pickerLabel && activeBranch) {
      this.pickerLabel.textContent = tx(activeBranch.name);
    }
    if (this.treeRows) {
      let html = this._buildTreeHtml(gameTree, "main", 0, true);
      html += `<div class="branchTreeRow branchTreeManage" data-branch-id="__MODAL__">
        <span class="branchTreePrefix"></span>
        <span class="branchTreeName">${tr("manageTree")}</span>
      </div>`;
      this.treeRows.innerHTML = html;
    }

    // 2. 更新播放控制列按鈕狀態
    const currIdx = historyList.findIndex((n) => n.id === currentNodeId);
    if (this.firstBtn) this.firstBtn.disabled = currIdx <= 0;
    if (this.prevBtn) this.prevBtn.disabled = currIdx <= 0;
    if (this.nextBtn) this.nextBtn.disabled = currIdx < 0 || currIdx >= historyList.length - 1;
    if (this.latestBtn) this.latestBtn.disabled = currIdx < 0 || currIdx >= historyList.length - 1;

    // 3. 渲染棋譜走法清單
    if (!this.container) return;

    if (historyList.length === 0) {
      this.container.innerHTML = `<div class="historyEmpty">${tr("noHistory")}</div>`;
      return;
    }

    let html = "";
    for (let i = 0; i < historyList.length; i++) {
      const node = historyList[i];
      const isCurrent = node.id === currentNodeId;
      const isRoot = node.stepIdx === 0;

      html += `
        <div class="historyItem ${isCurrent ? 'active' : ''} ${isRoot ? 'root' : ''}" data-node-id="${node.id}">
          <div class="historyStepCol">
            <span class="stepNum">#${node.stepIdx}</span>
          </div>
          <div class="historyContentCol">
            <div class="historyLogText">${pieceify(tx(node.logText))}</div>
            ${node.tag ? `<span class="tagBadge">${node.tag}</span>` : ''}
          </div>
        </div>
      `;
    }

    this.container.innerHTML = html;

    // 4. 自動滾動容器內部至當前選中手 (純容器捲動，絕對不影響外部全域視窗)
    const activeEl = this.container.querySelector(".historyItem.active");
    if (activeEl && this.container) {
      const cTop = this.container.scrollTop;
      const cHeight = this.container.clientHeight;
      const eTop = activeEl.offsetTop - this.container.offsetTop;
      const eHeight = activeEl.offsetHeight;

      if (eTop < cTop) {
        this.container.scrollTop = eTop;
      } else if (eTop + eHeight > cTop + cHeight) {
        this.container.scrollTop = eTop + eHeight - cHeight;
      }
    }
  }
}
