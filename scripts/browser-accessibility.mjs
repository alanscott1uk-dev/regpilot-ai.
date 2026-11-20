import axe from 'axe-core';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

export async function checkAccessibility(page, output, selector = 'html') {
  await page.locator(selector).waitFor({state:'visible'});
  await page.evaluate(axe.source);
  const findings = await page.evaluate(async scope => {
    const result = await window.axe.run(document.querySelector(scope), {
      runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},
    });
    const summarise = rules => rules.map(rule => ({
      rule: rule.id,
      impact: rule.impact,
      help: rule.helpUrl,
      elements: rule.nodes.map(node => ({selector:node.target,reason:node.failureSummary})),
    }));
    return {
      version: result.testEngine.version, scope,
      violations: summarise(result.violations),
      needsReview: summarise(result.incomplete),
    };
  }, selector);
  await mkdir(dirname(output), {recursive:true});
  await writeFile(output, JSON.stringify(findings, null, 2) + '\n');
  if (findings.violations.length) {
    throw Error('Accessibility violations in '+output+': '+findings.violations.map(rule=>rule.rule).join(', '));
  }
}
