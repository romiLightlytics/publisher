const core = require('@actions/core');
const github = require('@actions/github');
const {Octokit} = require('@octokit/rest');
const got = require('got');
const fs = require('fs')

function removeAwsCredentials(plan) {
    if (plan && plan.configuration && plan.configuration.provider_config && plan.configuration.provider_config.aws && plan.configuration.provider_config.aws.expressions) {
        delete plan['configuration']['provider_config']['aws']['expressions']['access_key']
        delete plan['configuration']['provider_config']['aws']['expressions']['secret_key']
    }
}

try {
    const hostname = core.getInput('ll-hostname')
    const terraformPlanPath = core.getInput('plan-json');
    const plan = JSON.parse(fs.readFileSync(terraformPlanPath, 'utf8'))

    const terraformGraphPath = core.getInput('tf-graph');
    let graph
    if (terraformGraphPath) {
        graph = fs.readFileSync(terraformGraphPath, 'utf8')
    }

    removeAwsCredentials(plan)

    const publishUrl = `https://${hostname}/api/v1/collection/terraform`
    const headers = {
        'X-Lightlytics-Token': core.getInput('collection-token')
    }

    const isPullRequestTriggered = github.context.payload.pull_request != null
    const source = formatGitMetadata(isPullRequestTriggered)

    const data = {
        plan,
        graph,
        metadata: {source},
    }

    got.post(publishUrl, {
        json: data,
        responseType: 'json',
        headers
    }).then((res) => {
        const eventId = res.body.eventId
        const customerId = res.body.customerId

        if (isPullRequestTriggered) {
            addCommentToPullRequest(`https://${hostname}/w/${customerId}/simulations/${eventId}`)
        }

        core.setOutput('EventId', eventId);
    }).catch(error => core.setFailed(error.message));
} catch (error) {
    core.setFailed(error.message);
}

function addCommentToPullRequest(link) {
    const pullRequestMessage = `An execution simulation has been generated by **Lightlytics**, to view this run impact analysis, Visit:
${link}

> _This comment was added automatically by a git workflow to help DevOps teams predict what will be the impact of the proposed change after completing this PR_`

    const octokit = new Octokit({
        auth: core.getInput('github-token')
    })

    octokit.issues.createComment({
        ...github.context.repo,
        issue_number: github.context.payload.pull_request.number,
        body: pullRequestMessage
    }).catch(err => console.log(`failed to send message on PR: ${err.message}`));
}

function formatGitMetadata(isPullRequestTriggered) {
    let source = {}

    if (isPullRequestTriggered) {
        source = {
            name: 'Github',
            type: 'Github',
            format: 'Terraform',
            branch: github.context.payload.pull_request.head.ref,
            base_branch: github.context.payload.pull_request.base.ref,
            commit_hash: github.context.payload.pull_request.head.sha,
            pr_id: github.context.payload.pull_request.number,
            repository: github.context.payload.repository.full_name,
            user_name: github.context.payload.pull_request.user.login
        }
    } else {
        source = {
            name: 'Github',
            type: 'Github',
            format: 'Terraform',
            branch: github.context.ref.replace('refs/heads/', ''),
            base_branch: github.context.payload.repository.default_branch,
            commit_hash: github.context.sha,
            pr_id: '',
            repository: github.context.payload.repository.full_name,
            user_name: github.context.actor
        }
    }
    return source
}