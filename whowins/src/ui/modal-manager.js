import { tr } from "../i18n.js";
/**
 * 🪟 骰子黑白棋 (Dice Othello) - 統一視窗管理系統 (Modal Manager)
 * 統一管理彈窗、確認對話框、鍵盤 ESC 與焦點鎖定
 */

export const ModalManager = {
  activeModals: new Set(),
  confirmCallback: null,

  init() {
    if (typeof window === "undefined") return;

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeTopModal();
      }
    });

    document.addEventListener("click", (e) => {
      if (e.target && e.target.classList && e.target.classList.contains("modalBackdrop")) {
        const modalId = e.target.dataset.modalId;
        if (modalId) this.close(modalId);
      }
    });
  },

  open(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    this.activeModals.add(modalId);
    document.body.classList.add("modal-open");

    // 自動聚焦於 modal 內部第一個可聚焦元素 (避免觸發頁面跳動)
    const focusable = el.querySelector("button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (focusable) focusable.focus({ preventScroll: true });
  },

  close(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    this.activeModals.delete(modalId);
    if (this.activeModals.size === 0) {
      document.body.classList.remove("modal-open");
    }
  },

  closeTopModal() {
    if (this.activeModals.size === 0) return;
    const arr = Array.from(this.activeModals);
    const top = arr[arr.length - 1];
    this.close(top);
  },

  closeAll() {
    for (const id of this.activeModals) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove("open");
        el.setAttribute("aria-hidden", "true");
      }
    }
    this.activeModals.clear();
    document.body.classList.remove("modal-open");
  },

  confirm({ title, message, confirmText = tr("confirmOk"), cancelText = tr("confirmCancel"), danger = false }) {
    return new Promise((resolve) => {
      const modalEl = document.getElementById("confirmModal");
      const titleEl = document.getElementById("confirmModalTitle");
      const msgEl = document.getElementById("confirmModalMessage");
      const okBtn = document.getElementById("confirmModalOkBtn");
      const cancelBtn = document.getElementById("confirmModalCancelBtn");

      if (!modalEl || !okBtn || !cancelBtn) {
        resolve(window.confirm(`${title}\n${message}`));
        return;
      }

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      if (danger) {
        okBtn.className = "btn danger";
      } else {
        okBtn.className = "btn primary";
      }

      const cleanup = () => {
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        this.close("confirmModal");
      };

      const onOk = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);

      this.open("confirmModal");
    });
  }
};
