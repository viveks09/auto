#!/usr/bin/env node
/**
 * ask-user.js
 * Interactive prompt helper — asks the user for input when a value cannot be
 * inferred automatically (e.g. repo name not found in Jira ticket).
 *
 * Usage:
 *   const { askUser, askUserSelect } = require('./ask-user');
 *
 *   const repoName = await askUser('Enter the target GitHub repo name: ');
 *   const format   = await askUserSelect('Choose export format:', ['csv', 'xlsx', 'json']);
 */

const readline = require('readline');

/**
 * Prompt the user for a free-text answer.
 * Keeps prompting until a non-empty value is provided (unless allowEmpty is true).
 *
 * @param {string}  question
 * @param {object}  opts
 * @param {string}  [opts.defaultValue]   — shown in brackets; used if user presses Enter
 * @param {boolean} [opts.allowEmpty]     — if true, empty input is accepted
 * @param {RegExp}  [opts.validate]       — if provided, input must match this pattern
 * @param {string}  [opts.validationMsg]  — shown when validate fails
 * @returns {Promise<string>}
 */
async function askUser(question, opts = {}) {
  const { defaultValue, allowEmpty = false, validate, validationMsg } = opts;

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  const prompt = defaultValue
    ? `${question} [${defaultValue}]: `
    : `${question}: `;

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(prompt, (answer) => {
        const value = answer.trim() || defaultValue || '';

        if (!allowEmpty && !value) {
          console.log('  ⚠️   A value is required. Please try again.\n');
          ask();
          return;
        }

        if (validate && value && !validate.test(value)) {
          console.log(`  ⚠️   ${validationMsg ?? 'Invalid format. Please try again.'}\n`);
          ask();
          return;
        }

        rl.close();
        resolve(value);
      });
    };
    ask();
  });
}

/**
 * Prompt the user to pick one option from a numbered list.
 *
 * @param {string}   question
 * @param {string[]} choices
 * @param {number}   [defaultIndex=0]   — 0-based index of the default choice
 * @returns {Promise<string>}           — the chosen value (not the number)
 */
async function askUserSelect(question, choices, defaultIndex = 0) {
  if (!choices.length) throw new Error('askUserSelect: choices array cannot be empty');

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  console.log(`\n${question}`);
  choices.forEach((c, i) => {
    const marker = i === defaultIndex ? ' (default)' : '';
    console.log(`  ${i + 1}. ${c}${marker}`);
  });

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(`\nEnter number [1-${choices.length}] (default ${defaultIndex + 1}): `, (answer) => {
        const trimmed = answer.trim();

        if (!trimmed) {
          rl.close();
          resolve(choices[defaultIndex]);
          return;
        }

        const num = parseInt(trimmed, 10);
        if (isNaN(num) || num < 1 || num > choices.length) {
          console.log(`  ⚠️   Please enter a number between 1 and ${choices.length}`);
          ask();
          return;
        }

        rl.close();
        resolve(choices[num - 1]);
      });
    };
    ask();
  });
}

/**
 * Prompt the user to confirm a yes/no question.
 *
 * @param {string}  question
 * @param {boolean} [defaultYes=true]
 * @returns {Promise<boolean>}
 */
async function askUserConfirm(question, defaultYes = true) {
  const hint   = defaultYes ? 'Y/n' : 'y/N';
  const answer = await askUser(`${question} [${hint}]`, { allowEmpty: true });
  if (!answer.trim()) return defaultYes;
  return /^y(es)?$/i.test(answer.trim());
}

module.exports = { askUser, askUserSelect, askUserConfirm };
