'use strict';
const request = require('request-promise');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const GITHUB_ORG = process.env.GITHUB_ORG;
const GITHUB_REPO = process.env.GITHUB_REPO;

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;

const GITHUB_BASE_URL = `https://api.github.com/repos/${GITHUB_ORG}/${GITHUB_REPO}`;

const github_request = request.defaults({headers: {Authorization: GITHUB_TOKEN, "User-Agent": "Awesome-Octocat-App"}});

function shouldSkipIssue(label) {
  return ["upto-qa", "qa-done", "Close予定", "WIP", "release-ok"].indexOf(label) >= 0
}

function shouldCloseIssue(timeline) {
  const now = new Date();
  const deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  for (let i = timeline.nodes.length - 1; i >= 0; i -= 1) {
    const node = timeline.nodes[i];
    if (node.__typename == "LabeledEvent" && node.label.name == "Close予定") {
      if (new Date(node.createdAt) <= deadline) return true
      else return false
    }
  }
  return false
}

async function postToSlack(issues) {
  const issueList = "```\n" + issues.map(issue => `・${issue.title} ${issue.url}`).join("\n") + "\n```"
  const text = `
@fodev

今週closeされたプルリクと来週close予定のプルリク一覧です。
各プルリクを確認し、リリースされるように対応を進めて下さい。

> 来週close予定のプルリク一覧

https://github.com/orcainc/homeup/pulls?q=is%3Aopen+is%3Apr+label%3AClose%E4%BA%88%E5%AE%9A

> 今週closeされたプルリク一覧
${issueList}
  `;
  return request.get({url: 'https://slack.com/api/chat.postMessage', qs: {token: SLACK_TOKEN, channel: SLACK_CHANNEL, text}, headers: {Authorization: `bearer ${SLACK_TOKEN}`}});
}

async function checkIssue(page=1) {
  const now = new Date();
  const deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const pulls = await github_request.get({url: `${GITHUB_BASE_URL}/pulls?direction=asc&page=${page}`, json: true});
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
    github_request.post({url: `${GITHUB_BASE_URL}/issues/${pull.number}/labels`, json: ["Close予定"]})
  });
  if (pulls.length == 0 || stop) return Promise.resolve();
  return checkIssue(page + 1);
};

async function prepairCloseIssue(cursor=null, closingIssues=[]) {
  const now = new Date();
  const page = cursor ? `, after: "${cursor}"` : "";
  const query = `query {
    repository(owner:"orcainc", name:"homeup") {
      pullRequests(last: 100, labels: "Close予定", states: OPEN${page}) {
        edges {
          cursor
          node {
            number
            title
            url
            timeline(last: 100) {
              nodes {
                __typename
                ... on LabeledEvent {
                  createdAt
                  label {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;
  const response = await github_request.post({url: "https://api.github.com/graphql", json: {query, variables: {}}});
  let lastCursor = null;
  response.data.repository.pullRequests.edges.forEach(pullRequest => {
    lastCursor = pullRequest.cursor;
    if (shouldCloseIssue(pullRequest.node.timeline))
      closingIssues.push({number: pullRequest.node.number, title: pullRequest.node.title, url: pullRequest.node.url});
  })
  if (lastCursor) {
    console.log(`Checking ${lastCursor} - ${response.data.repository.pullRequests.edges.length} issues`);
    return prepairCloseIssue(lastCursor, closingIssues);
  }
  else return Promise.resolve(closingIssues);
}

async function closeIssues(issues) {
  return Promise.all(issues.map(issue => github_request.post({url: `${GITHUB_BASE_URL}/pulls/${issue.number}`, json: {state: "closed"}})))
}

async function main() {
  const closeIssues = await prepairCloseIssue();
  await closeIssues(closeIssues);
  await checkIssue();
  if (closeIssues.length > 0) await postToSlack(closeIssues);
  return Promise.resolve("Done");
}

exports.handler = async (event, context, callback) => {
  await main();
  callback();
}
// main()
