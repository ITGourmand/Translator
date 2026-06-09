import { createElement } from "./dom.js";

const TOAST_CLASSES = Object.freeze({
    success: "border-emerald-500 bg-white text-slate-800 shadow-md",
    error: "border-red-500 bg-white text-slate-800 shadow-md",
    info: "border-cyan-500 bg-white text-slate-800 shadow-md",
});

export function showToast(title, message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = createElement(
        "div",
        {
            className: `p-4 border-l-4 rounded-r-lg shadow-lg flex flex-col transition duration-300 transform translate-y-2 ${TOAST_CLASSES[type] || TOAST_CLASSES.info}`,
        },
        [
            createElement("strong", { className: "font-bold text-sm text-slate-900", text: title }),
            createElement("span", { className: "text-xs text-slate-600 mt-0.5", text: message }),
        ],
    );

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("opacity-0");
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
