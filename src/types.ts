export type GuideKind = "override" | "standard";

export type CandidateStatus =
  | "selected"
  | "shadowed"
  | "empty"
  | "over-limit"
  | "unreadable";

export type Severity = "error" | "warning" | "note";

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  file: string;
  line?: number;
  column?: number;
  target?: string;
}

export interface GuideCandidate {
  path: string;
  directory: string;
  kind: GuideKind;
  status: CandidateStatus;
  bytes: number;
}

export interface GuideFile {
  path: string;
  directory: string;
  kind: GuideKind;
  content: string;
  bytes: number;
}

export interface Resolution {
  root: string;
  cwd: string;
  directories: string[];
  candidates: GuideCandidate[];
  selected: GuideFile[];
  totalBytes: number;
  maxBytes: number;
  diagnostics: Diagnostic[];
}

export interface ResolveOptions {
  cwd: string;
  root?: string;
  maxBytes?: number;
}

export interface Summary {
  errors: number;
  warnings: number;
  notes: number;
}

export type OutputFormat = "text" | "json" | "sarif";
