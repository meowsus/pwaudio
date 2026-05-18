/**
 * Minimal DOM helpers to avoid innerHTML in demo pages.
 * All data is controlled (no user input), but using proper DOM APIs
 * satisfies static analysis and is a better practice.
 */

/** Create an element with optional className, text, and children */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	opts?: {
		className?: string;
		textContent?: string;
		id?: string;
		type?: string;
		min?: string;
		max?: string;
		step?: string;
		value?: string;
		style?: string;
		href?: string;
		dataType?: string;
		dataset?: Record<string, string>;
	},
	...children: Node[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (opts?.className) node.className = opts.className;
	if (opts?.textContent) node.textContent = opts.textContent;
	if (opts?.id) node.id = opts.id;
	if (opts?.type) (node as HTMLInputElement).type = opts.type;
	if (opts?.min !== undefined) (node as HTMLInputElement).min = opts.min;
	if (opts?.max !== undefined) (node as HTMLInputElement).max = opts.max;
	if (opts?.step !== undefined) (node as HTMLInputElement).step = opts.step;
	if (opts?.value !== undefined) (node as HTMLInputElement).value = opts.value;
	if (opts?.style) node.setAttribute("style", opts.style);
	if (opts?.href) (node as HTMLAnchorElement).href = opts.href;
	if (opts?.dataType) node.setAttribute("data-type", opts.dataType);
	if (opts?.dataset) Object.assign(node.dataset, opts.dataset);
	for (const child of children) node.appendChild(child);
	return node;
}

/** Shorthand for text-only span with optional className */
export function span(className: string, text: string): HTMLSpanElement {
	const s = document.createElement("span");
	s.className = className;
	s.textContent = text;
	return s;
}

/** Shorthand for a label wrapping content */
export function label(text: string, ...children: HTMLElement[]): HTMLLabelElement {
	const l = document.createElement("label");
	l.textContent = text;
	for (const c of children) l.appendChild(c);
	return l;
}
