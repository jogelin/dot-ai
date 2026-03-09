/**
 * Custom vitest matchers for dot-ai E2E assertions.
 *
 * Registered globally via src/setup.ts (vitest setupFiles).
 * Extend this file as new features are added.
 *
 * Usage (after setup):
 *   expect(result.sections).toHaveSection('dot-ai:system');
 *   expect(result.sections).toHaveSkillSection('deploy');
 *   expect(result.sections).toHaveDirectiveForSkill('deploy');
 *   expect(result.sections).toHaveSectionContent('memory:recall', /authentication/);
 */
import { expect } from 'vitest';
import type { Section } from '@dot-ai/core';

interface SectionWithLevel extends Section {
  detailLevel?: 'directive' | 'overview' | 'full';
}

// ── Matcher declarations for TypeScript ───────────────────────────────────────

interface CustomMatchers<R = unknown> {
  toHaveSection(id: string): R;
  toNotHaveSection(id: string): R;
  toHaveSkillSection(skillName: string): R;
  toHaveDirectiveForSkill(skillName: string): R;
  toHaveOverviewForSkill(skillName: string): R;
  toHaveSectionContent(id: string, expected: string | RegExp): R;
  toHaveArchitectureEntry(category: string): R;
  toHaveSectionWithPriority(id: string, priority: number): R;
  toHaveSectionWithSource(id: string, source: string): R;
  toHaveSectionsOrderedByPriority(): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

// ── Matcher implementations ───────────────────────────────────────────────────

export function setupMatchers(): void {
  expect.extend({

    /**
     * Assert a section with the given id is present.
     * expect(result.sections).toHaveSection('dot-ai:system')
     */
    toHaveSection(sections: Section[], id: string) {
      const has = sections.some(s => s.id === id);
      return {
        pass: has,
        message: () => has
          ? `Expected sections NOT to contain section "${id}" but it was found`
          : `Expected sections to contain section "${id}" but it was not found\n` +
            `  Present ids: ${sections.map(s => s.id ?? `(anon:${s.source})`).join(', ')}`,
      };
    },

    /**
     * Assert no section with the given id is present.
     * expect(result.sections).toNotHaveSection('memory:recall')
     */
    toNotHaveSection(sections: Section[], id: string) {
      const has = sections.some(s => s.id === id);
      return {
        pass: !has,
        message: () => !has
          ? `Expected sections to contain section "${id}" but it was not found`
          : `Expected sections NOT to contain section "${id}" but it was found`,
      };
    },

    /**
     * Assert a skill section (id: 'skill:{name}') is present.
     * expect(result.sections).toHaveSkillSection('deploy')
     */
    toHaveSkillSection(sections: Section[], skillName: string) {
      const has = sections.some(s => s.id === `skill:${skillName}`);
      return {
        pass: has,
        message: () => has
          ? `Expected skill "${skillName}" NOT to be in sections but it was found`
          : `Expected skill "${skillName}" to be in sections but it was not found\n` +
            `  Skill sections: ${sections.filter(s => s.id?.startsWith('skill:')).map(s => s.id).join(', ') || '(none)'}`,
      };
    },

    /**
     * Assert a skill section has detailLevel = 'directive'.
     * (Requires Phase 2 implementation — will fail until detailLevel is added)
     * expect(result.sections).toHaveDirectiveForSkill('deploy')
     */
    toHaveDirectiveForSkill(sections: SectionWithLevel[], skillName: string) {
      const section = sections.find(s => s.id === `skill:${skillName}`);
      const hasSkill = section !== undefined;
      const isDirective = hasSkill && section!.detailLevel === 'directive';
      return {
        pass: isDirective,
        message: () => isDirective
          ? `Expected skill "${skillName}" NOT to be directive`
          : !hasSkill
            ? `Expected skill "${skillName}" to be directive but section not found`
            : `Expected skill "${skillName}" to be directive but detailLevel is "${section!.detailLevel ?? 'undefined'}"`,
      };
    },

    /**
     * Assert a skill section has detailLevel = 'overview'.
     * (Requires Phase 2 implementation — will fail until detailLevel is added)
     * expect(result.sections).toHaveOverviewForSkill('git-basics')
     */
    toHaveOverviewForSkill(sections: SectionWithLevel[], skillName: string) {
      const section = sections.find(s => s.id === `skill:${skillName}`);
      const hasSkill = section !== undefined;
      const isOverview = hasSkill && section!.detailLevel === 'overview';
      return {
        pass: isOverview,
        message: () => isOverview
          ? `Expected skill "${skillName}" NOT to be overview`
          : !hasSkill
            ? `Expected skill "${skillName}" to be overview but section not found`
            : `Expected skill "${skillName}" to be overview but detailLevel is "${section!.detailLevel ?? 'undefined'}"`,
      };
    },

    /**
     * Assert a section's content contains a string or matches a regex.
     * expect(result.sections).toHaveSectionContent('memory:recall', /authentication/)
     */
    toHaveSectionContent(sections: Section[], id: string, expected: string | RegExp) {
      const section = sections.find(s => s.id === id);
      if (!section) {
        return {
          pass: false,
          message: () =>
            `Expected section "${id}" to exist with matching content but section was not found`,
        };
      }
      const matches = expected instanceof RegExp
        ? expected.test(section.content)
        : section.content.includes(expected);
      return {
        pass: matches,
        message: () => matches
          ? `Expected section "${id}" content NOT to match ${expected}`
          : `Expected section "${id}" content to match ${expected}\n  Actual:\n${section.content}`,
      };
    },

    /**
     * Assert the system section (dot-ai:system) contains an architecture entry
     * for the given category string (case-insensitive).
     * (Requires Phase 1 metadata implementation)
     * expect(result.sections).toHaveArchitectureEntry('memory')
     */
    toHaveArchitectureEntry(sections: Section[], category: string) {
      const sys = sections.find(s => s.id === 'dot-ai:system');
      if (!sys) {
        return {
          pass: false,
          message: () =>
            `Expected system section to contain architecture entry for "${category}" but system section not found`,
        };
      }
      const has = sys.content.toLowerCase().includes(category.toLowerCase());
      return {
        pass: has,
        message: () => has
          ? `Expected system section NOT to contain "${category}"`
          : `Expected system section to contain "${category}"\n  Actual content:\n${sys.content}`,
      };
    },

    /**
     * Assert a section has the expected priority.
     * expect(result.sections).toHaveSectionWithPriority('dot-ai:system', 95)
     */
    toHaveSectionWithPriority(sections: Section[], id: string, priority: number) {
      const section = sections.find(s => s.id === id);
      if (!section) {
        return {
          pass: false,
          message: () => `Expected section "${id}" to exist with priority ${priority} but section not found`,
        };
      }
      const matches = section.priority === priority;
      return {
        pass: matches,
        message: () => matches
          ? `Expected section "${id}" NOT to have priority ${priority}`
          : `Expected section "${id}" to have priority ${priority} but got ${section.priority}`,
      };
    },

    /**
     * Assert a section was produced by a specific extension.
     * expect(result.sections).toHaveSectionWithSource('skill:deploy', 'ext-file-skills')
     */
    toHaveSectionWithSource(sections: Section[], id: string, source: string) {
      const section = sections.find(s => s.id === id);
      if (!section) {
        return {
          pass: false,
          message: () => `Expected section "${id}" to exist with source "${source}" but section not found`,
        };
      }
      const matches = section.source === source;
      return {
        pass: matches,
        message: () => matches
          ? `Expected section "${id}" NOT to have source "${source}"`
          : `Expected section "${id}" to have source "${source}" but got "${section.source}"`,
      };
    },

    /**
     * Assert all sections are ordered highest priority first.
     * expect(result.sections).toHaveSectionsOrderedByPriority()
     */
    toHaveSectionsOrderedByPriority(sections: Section[]) {
      const violations: string[] = [];
      for (let i = 0; i < sections.length - 1; i++) {
        if (sections[i].priority < sections[i + 1].priority) {
          violations.push(
            `sections[${i}] (id="${sections[i].id}", priority=${sections[i].priority}) < ` +
            `sections[${i + 1}] (id="${sections[i + 1].id}", priority=${sections[i + 1].priority})`,
          );
        }
      }
      const ordered = violations.length === 0;
      return {
        pass: ordered,
        message: () => ordered
          ? 'Expected sections NOT to be ordered by priority but they are'
          : `Expected sections to be ordered by priority DESC but found:\n  ${violations.join('\n  ')}`,
      };
    },
  });
}
