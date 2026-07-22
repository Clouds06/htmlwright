export type Scope = "element" | "unit" | "page" | "document";
export type ProviderName = "claude-code" | "anthropic-api" | "demo";

export interface ElementSummary {
  id?: string;
  tag: string;
  classes: string[];
  text: string;
  outerHTML: string;
  breadcrumb?: string;
  unitIndex?: number;
  sourcePath?: number[];
  editableText?: string;
  computedStyle?: {
    color?: string;
    backgroundColor?: string;
    fontSize?: string;
  };
}

export interface QuickEditRequest {
  selectedElement: ElementSummary;
  changes: {
    text?: string;
    color?: string;
    backgroundColor?: string;
    fontSize?: number;
  };
  unitIndex?: number;
}

export interface EditRequest {
  intent: string;
  scope: Scope;
  provider: ProviderName;
  selectedElement?: ElementSummary;
  unitIndex?: number;
}

export interface TaskPackage extends EditRequest {
  fullFile: string;
  unitHTML?: string;
  relatedCSS: string[];
}

export interface ProviderResult {
  html: string;
  raw?: string;
}

export interface UnitVerification {
  index: number;
  changedRatio: number;
}

export interface VerificationResult {
  available: boolean;
  targetChanged: boolean;
  changedRatio: number;
  collateralUnits: UnitVerification[];
  overflow: boolean;
  overflowElements: string[];
  overlaps: string[];
  beforeShot?: string;
  afterShot?: string;
  diffShot?: string;
  warning?: string;
}

export interface ProviderStatus {
  name: ProviderName;
  available: boolean;
  message: string;
  auth?: string;
}
