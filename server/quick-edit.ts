import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from "parse5";
import type { QuickEditRequest } from "./types.ts";

type ElementNode = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

interface SourceEdit {
  start: number;
  end: number;
  value: string;
}

function elementChildren(node: ParentNode): ElementNode[] {
  return node.childNodes.filter(child => defaultTreeAdapter.isElementNode(child));
}

function locateElement(html: string, sourcePath: number[]): ElementNode {
  const document = parse(html, { sourceCodeLocationInfo: true });
  let current = elementChildren(document).find(node => node.tagName === "html");
  if (!current) throw new Error("无法定位 HTML 根节点");
  for (const index of sourcePath) {
    if (!Number.isInteger(index) || index < 0) throw new Error("元素路径无效");
    current = elementChildren(current)[index];
    if (!current) throw new Error("候选结构已经变化，请重新选择元素");
  }
  return current;
}

function setStyleProperty(style: string, property: string, value: string): string {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|;)\\s*${escapedProperty}\\s*:[^;]*`, "i");
  if (pattern.test(style)) return style.replace(pattern, (_match, prefix: string) => `${prefix}${prefix ? " " : ""}${property}: ${value}`);
  const trimmed = style.trim();
  return `${trimmed}${trimmed && !trimmed.endsWith(";") ? ";" : ""}${trimmed ? " " : ""}${property}: ${value}`;
}

function validateColor(value: string, label: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${label}必须是六位十六进制颜色`);
  return value.toLowerCase();
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function applyQuickEdit(html: string, request: QuickEditRequest): string {
  const sourcePath = request.selectedElement.sourcePath;
  if (!sourcePath) throw new Error("当前元素缺少源码位置，请刷新页面后重新选择");
  const element = locateElement(html, sourcePath);
  if (element.tagName !== request.selectedElement.tag.toLowerCase()) throw new Error("候选结构已经变化，请重新选择元素");
  const location = element.sourceCodeLocation;
  if (!location?.startTag) throw new Error("该元素没有可编辑的源码位置");
  const changes = request.changes || {};
  const edits: SourceEdit[] = [];

  if (changes.text !== undefined) {
    if (!location.endTag) throw new Error("该元素不支持文字编辑");
    if (changes.text.length > 10_000) throw new Error("快速编辑文字不能超过 10000 个字符");
    edits.push({ start: location.startTag.endOffset, end: location.endTag.startOffset, value: escapeText(changes.text) });
  }

  const hasStyleChange = changes.color !== undefined || changes.backgroundColor !== undefined || changes.fontSize !== undefined;
  if (hasStyleChange) {
    const styleAttribute = element.attrs.find(attribute => attribute.name === "style");
    let style = styleAttribute?.value || "";
    if (changes.color !== undefined) style = setStyleProperty(style, "color", validateColor(changes.color, "文字颜色"));
    if (changes.backgroundColor !== undefined) style = setStyleProperty(style, "background-color", validateColor(changes.backgroundColor, "背景颜色"));
    if (changes.fontSize !== undefined) {
      if (!Number.isFinite(changes.fontSize) || changes.fontSize < 6 || changes.fontSize > 200) throw new Error("字号必须在 6 到 200 px 之间");
      style = setStyleProperty(style, "font-size", `${Math.round(changes.fontSize * 10) / 10}px`);
    }
    const styleLocation = location.attrs?.style;
    if (styleLocation) {
      edits.push({ start: styleLocation.startOffset, end: styleLocation.endOffset, value: `style="${style.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"` });
    } else {
      const startTag = html.slice(location.startTag.startOffset, location.startTag.endOffset);
      const closingOffset = startTag.lastIndexOf("/>") >= 0 ? startTag.lastIndexOf("/>") : startTag.lastIndexOf(">");
      edits.push({ start: location.startTag.startOffset + closingOffset, end: location.startTag.startOffset + closingOffset, value: ` style="${style}"` });
    }
  }

  if (!edits.length) throw new Error("没有需要应用的快速修改");
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
  }
  return output;
}
