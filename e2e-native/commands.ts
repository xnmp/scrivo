import { $, browser } from '@wdio/globals';
export async function runCommand(label: string) {
  await browser.keys(['Control', 'p']); await $('[aria-label="Search commands"]').waitForDisplayed();
  await $('[aria-label="Search commands"]').setValue(label); await browser.keys('Enter');
}
export async function openSettings(section = 'Appearance') {
  await browser.keys(['Control', ',']); await $('.settings-dialog').waitForDisplayed();
  await $(`//nav[@aria-label="Settings sections"]//button[normalize-space(.)="${section}"]`).click();
}
