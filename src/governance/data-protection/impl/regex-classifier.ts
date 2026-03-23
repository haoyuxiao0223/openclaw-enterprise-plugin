import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type {
  ContentFilter,
  FilterableContent,
  FilterResult,
  FilterViolation,
} from "../content-filter.ts";

export interface RegexClassifierRule {
  name: string;
  pattern: RegExp;
  severity: FilterViolation["severity"];
  action: FilterResult["action"];
  replacement?: string;
}

function actionRank(a: FilterResult["action"]): number {
  switch (a) {
    case "allow":
      return 0;
    case "redact":
      return 1;
    case "review":
      return 2;
    case "block":
      return 3;
    default:
      return 0;
  }
}

function globalPattern(pattern: RegExp): RegExp {
  const flags = pattern.global ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

export class RegexClassifier implements ContentFilter {
  private readonly rules: readonly RegexClassifierRule[];

  constructor(
    rules: readonly RegexClassifierRule[],
    public readonly direction: ContentFilter["direction"] = "both",
  ) {
    this.rules = rules;
  }

  async filter(_ctx: TenantContext, content: FilterableContent): Promise<FilterResult> {
    const violations: FilterViolation[] = [];
    let worst: FilterResult["action"] = "allow";
    const sourceText = content.text ?? "";

    for (const rule of this.rules) {
      const re = globalPattern(rule.pattern);
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(sourceText)) !== null) {
        if (match[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        violations.push({
          rule: rule.name,
          severity: rule.severity,
          description: `Content matched rule "${rule.name}"`,
          matchedContent: match[0],
        });
        if (actionRank(rule.action) > actionRank(worst)) {
          worst = rule.action;
        }
        if (!re.global) {
          break;
        }
      }
    }

    if (violations.length === 0) {
      return {
        passed: true,
        content: { ...content },
        violations,
        action: "allow",
      };
    }

    if (worst === "block") {
      return {
        passed: false,
        content: {
          ...content,
          text: "",
          attachments: [],
          toolCalls: [],
        },
        violations,
        action: "block",
      };
    }

    if (worst === "review") {
      return {
        passed: false,
        content: { ...content },
        violations,
        action: "review",
      };
    }

    if (worst === "redact") {
      let text = sourceText;
      for (const rule of this.rules) {
        if (rule.action !== "redact") {
          continue;
        }
        const re = globalPattern(rule.pattern);
        const replacement = rule.replacement ?? "[REDACTED]";
        text = text.replace(re, replacement);
      }
      return {
        passed: true,
        content: { ...content, text },
        violations,
        action: "redact",
      };
    }

    return {
      passed: true,
      content: { ...content },
      violations,
      action: "allow",
    };
  }
}
