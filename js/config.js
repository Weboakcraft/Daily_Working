/**
 * Oakcraft Daily Working Tracker — frontend configuration.
 *
 * STEP (one-time): after deploying the Apps Script Web App, paste its URL below.
 * It looks like: https://script.google.com/macros/s/AKfycb..../exec
 * This file holds NO passwords or secrets; the URL only reaches the API, which checks every request.
 */
export const CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwMFL69rEQH6lvs6Y65hgu10BH9bYA8yBNL3W9QMKLoetLAnGyrY4akTOw6pQp1Qvj3/exec',
  /* Bumping this also makes every browser pick up the new app files on the next visit. */
  APP_VERSION: '1.1.0',
  REQUEST_TIMEOUT_MS: 45000,
  /*
   * How long to wait after the last keystroke before saving the draft.
   * Every save is a write that takes the one lock the whole system shares, so at 2.5 seconds a
   * roomful of people typing their reports kept that lock permanently busy and everyone's save
   * started failing with "the system is busy". Twenty seconds is still well inside the window
   * where nothing is lost: every keystroke is written to the device immediately, the draft is
   * saved whenever you leave the page or switch away from the app, and again just before the
   * deadline closes.
   */
  AUTOSAVE_DELAY_MS: 20000
};
