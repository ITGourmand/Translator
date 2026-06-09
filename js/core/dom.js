export function byId(id, root = document) {
    return root.getElementById(id);
}

export function clearElement(element) {
    if (element) element.replaceChildren();
}

export function setText(element, value) {
    if (element) element.textContent = value == null ? "" : String(value);
}

export function setClass(element, className) {
    if (element) element.className = className;
}

export function createElement(tagName, options = {}, children = []) {
    const element = document.createElement(tagName);
    const {
        className,
        text,
        id,
        type,
        value,
        href,
        title,
        ariaLabel,
        disabled,
        hidden,
        dataset,
        attributes,
    } = options;

    if (id) element.id = id;
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    if (type) element.type = type;
    if (value !== undefined) element.value = value;
    if (href !== undefined) element.setAttribute("href", href);
    if (title) element.title = title;
    if (ariaLabel) element.setAttribute("aria-label", ariaLabel);
    if (disabled !== undefined) element.disabled = Boolean(disabled);
    if (hidden !== undefined) element.hidden = Boolean(hidden);

    if (dataset) {
        Object.entries(dataset).forEach(([key, itemValue]) => {
            if (itemValue !== undefined && itemValue !== null) {
                element.dataset[key] = String(itemValue);
            }
        });
    }

    if (attributes) {
        Object.entries(attributes).forEach(([name, itemValue]) => {
            if (itemValue !== undefined && itemValue !== null) {
                element.setAttribute(name, String(itemValue));
            }
        });
    }

    const childList = Array.isArray(children) ? children : [children];
    childList.filter(Boolean).forEach((child) => {
        element.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });

    return element;
}

export function appendMessage(container, message, className = "text-xs text-stone-400 italic") {
    clearElement(container);
    container.appendChild(createElement("p", { className, text: message }));
}

export function createOption(value, label, selected = false) {
    const option = createElement("option", { value, text: label });
    option.selected = selected;
    return option;
}

export function setButtonBusy(button, isBusy, label, busyLabel = label) {
    if (!button) return;
    button.disabled = isBusy;
    button.textContent = isBusy ? busyLabel : label;
}

export function createSvgIcon(pathData, className = "h-4 w-4") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("fill", "none");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
    return svg;
}
