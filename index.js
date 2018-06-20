'use strict';
const request = require('request-promise');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_BASE_URL = process.env.GITHUB_BASE_URL;

function shouldSkipIssue(label) {
  return ["upto-qa", "qa-done", "Close予定", "release-ok"].indexOf(label) >= 0
}

async function checkIssue(page=1) {
  const now = new Date();
  const deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const pulls = await request.get({url: `${GITHUB_BASE_URL}/pulls?direction=asc&page=${page}`, json: true, headers: {Authorization: GITHUB_TOKEN, "User-Agent": "Awesome-Octocat-App"}});
  let stop = false;
  pulls.forEach(pull => {
    let skip = false;
    pull.labels.forEach(label => {
      if (shouldSkipIssue(label.name)) {
        skip = true;
      }
    })
    if (skip) return;
    if (deadline < new Date(pull.created_at)) {
      stop = true;
      return false;
    }
    request.post({url: `${GITHUB_BASE_URL}/issues/${pull.number}/labels`, json: ["Close予定"], headers: {Authorization: GITHUB_TOKEN, "User-Agent": "Awesome-Octocat-App"}})
  });
  if (pulls.length == 0 || stop) return Promise.resolve();
  return checkIssue(page + 1);
};

exports.handler = async (event, context, callback) => {
  await checkIssue();
  callback();
}
