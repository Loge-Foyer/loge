/**
 * The version after `current` for a release made at `now`: that release's
 * year and month, and the build counted on from the last one. The build never
 * starts again — not at a new month, not at a new year — so it is also the
 * build number both stores want, which may only ever go up.
 *
 * No leading zero in the month: semver refuses `2027.03.4`, and the stores
 * read `03` and `3` as the same number.
 *
 * @param {string} current
 * @param {Date} now
 * @returns {string}
 */
export function nextVersion(current, now) {
  const match = /^(\d{4})\.([1-9]|1[0-2])\.([1-9]\d*)$/.exec(current);
  if (!match) throw new Error(`${current} is not YEAR.MONTH.BUILD.`);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (year * 12 + month < Number(match[1]) * 12 + Number(match[2])) {
    throw new Error(`The clock says ${year}.${month}, before ${current}.`);
  }
  return `${year}.${month}.${Number(match[3]) + 1}`;
}
