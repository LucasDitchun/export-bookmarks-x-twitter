const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type InterfaceIcon = "edit" | "trash";

const ICON_PATHS: Record<InterfaceIcon, readonly string[]> = {
  edit: [
    "M13.5 6.5l4 4",
    "M4 20l3.75-.75L18.5 8.5a2.83 2.83 0 0 0-4-4L3.75 15.25 3 19a.83.83 0 0 0 1 1Z",
  ],
  trash: ["M4 7h16", "M9 7V4h6v3", "M7 7l1 13h8l1-13", "M10 11v5", "M14 11v5"],
};

export function createInterfaceIcon(
  document: Document,
  icon: InterfaceIcon,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const pathData of ICON_PATHS[icon]) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

export function createIconButton(options: {
  document: Document;
  icon: InterfaceIcon;
  label: string;
  className?: string;
}): HTMLButtonElement {
  const button = options.document.createElement("button");
  button.type = "button";
  button.className = ["icon-button", options.className].filter(Boolean).join(" ");
  button.setAttribute("aria-label", options.label);
  button.title = options.label;
  button.append(createInterfaceIcon(options.document, options.icon));
  return button;
}
