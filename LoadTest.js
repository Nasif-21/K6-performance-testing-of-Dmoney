import http from 'k6/http';
import exec from 'k6/execution';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const LOGIN_PATH = __ENV.LOGIN_PATH || '/user/login';
const VERIFY_OTP_PATH = __ENV.VERIFY_OTP_PATH || '/user/verify-otp';
const PAUSE_SECONDS = Number(__ENV.PAUSE_SECONDS || 1);
const X_AUTH_SECRET_KEY = __ENV.X_AUTH_SECRET_KEY||'ROADTOSDET';
const GMAIL_ACCESS_TOKEN = __ENV.GMAIL_ACCESS_TOKEN;
const OTP_TIMEOUT_SECONDS = Number(__ENV.OTP_TIMEOUT_SECONDS || 30);
const OTP_POLL_INTERVAL_SECONDS = Number(__ENV.OTP_POLL_INTERVAL_SECONDS || 2);
const AMOUNT = Number(__ENV.AMOUNT || 50);

const transactionResponseTime = new Trend('transaction_response_time', true);
const transactionRequestCount = new Counter('transaction_request_count');
const transactionFailures = new Rate('transaction_failures');
const transactionChecks = new Rate('transaction_checks');

const users = [
    {
        name: 'agent1',
        email: __ENV.AGENT1_EMAIL || __ENV.AGENT1_USERNAME||'skfamily0304+k6agt1@gmail.com',
        password: __ENV.AGENT1_PASSWORD||'1234',
        account: __ENV.AGENT1_ACCOUNT || '01234567881',
    },
    {
        name: 'agent2',
        email: __ENV.AGENT2_EMAIL || __ENV.AGENT2_USERNAME||'skfamily0304+k6agt2@gmail.com',
        password: __ENV.AGENT2_PASSWORD||'1234',
        account: __ENV.AGENT2_ACCOUNT || '01234567882',
    },
    {
        name: 'customer1',
        email: __ENV.CUSTOMER1_EMAIL || __ENV.CUSTOMER1_USERNAME||'skfamily0304+k6cst1@gmail.com',
        password: __ENV.CUSTOMER1_PASSWORD||'1234',
        account: __ENV.CUSTOMER1_ACCOUNT || '01234567871',
    },
    {
        name: 'customer2',
        email: __ENV.CUSTOMER2_EMAIL || __ENV.CUSTOMER2_USERNAME||'skfamily0304+k6cst2@gmail.com',
        password: __ENV.CUSTOMER2_PASSWORD||'1234',
        account: __ENV.CUSTOMER2_ACCOUNT || '01234567872',
    },
    {
        name: 'merchant1',
        email: __ENV.MERCHANT1_EMAIL || __ENV.MERCHANT1_USERNAME||'skfamily0304+k6mar1@gmail.com',
        password: __ENV.MERCHANT1_PASSWORD||'1234',
        account: __ENV.MERCHANT1_ACCOUNT || '01234567890',
    },
    {
        name: 'merchant2',
        email: __ENV.MERCHANT2_EMAIL || __ENV.MERCHANT2_USERNAME||'skfamily0304+k6mar2@gmail.com',
        password: __ENV.MERCHANT2_PASSWORD||'1234',
        account: __ENV.MERCHANT2_ACCOUNT || '01234567891',
    },
];

const schedules = {
    agent1: [null, 'deposit-customer2', 'deposit-customer1', 'payment-merchant1-agent'],
    agent2: [null, null, 'deposit-customer2-agent2', 'payment-merchant2-agent'],
    customer1: ['send-customer1-to-customer2', 'payment-merchant1-customer1', 'send-customer1-to-customer2', 'payment-merchant1-customer1'],
    customer2: ['payment-merchant1-customer2', 'send-customer2-to-customer1', 'payment-merchant2-customer2', 'payment-merchant2-customer2'],
    merchant1: [null, null, null, null],
    merchant2: [null, null, null, null],
};

const transactions = {
    'deposit-customer1': {
        path: '/transaction/deposit',
        type: 'deposit',
        from: 'agent1',
        to: 'customer1',
        expectedMessage: 'Deposit successful',
    },
    'deposit-customer2': {
        path: '/transaction/deposit',
        type: 'deposit',
        from: 'agent1',
        to: 'customer2',
        expectedMessage: 'Deposit successful',
    },
    'deposit-customer2-agent2': {
        path: '/transaction/deposit',
        type: 'deposit',
        from: 'agent2',
        to: 'customer2',
        expectedMessage: 'Deposit successful',
    },
    'send-customer1-to-customer2': {
        path: '/transaction/sendmoney',
        type: 'sendmoney',
        from: 'customer1',
        to: 'customer2',
        expectedMessage: 'Send money successful',
    },
    'send-customer2-to-customer1': {
        path: '/transaction/sendmoney',
        type: 'sendmoney',
        from: 'customer2',
        to: 'customer1',
        expectedMessage: 'Send money successful',
    },
    'payment-merchant1-customer1': {
        path: '/transaction/payment',
        type: 'payment',
        from: 'customer1',
        to: 'merchant1',
        expectedMessage: 'Payment successful',
    },
    'payment-merchant1-customer2': {
        path: '/transaction/payment',
        type: 'payment',
        from: 'customer2',
        to: 'merchant1',
        expectedMessage: 'Payment successful',
    },
    'payment-merchant2-customer2': {
        path: '/transaction/payment',
        type: 'payment',
        from: 'customer2',
        to: 'merchant2',
        expectedMessage: 'Payment successful',
    },
    'payment-merchant1-agent': {
        path: '/transaction/payment',
        type: 'payment',
        from: 'agent1',
        to: 'merchant1',
        expectedMessage: 'Payment successful',
    },
    'payment-merchant2-agent': {
        path: '/transaction/payment',
        type: 'payment',
        from: 'agent2',
        to: 'merchant2',
        expectedMessage: 'Payment successful',
    },
};

const activeTransactionsByWindow = {
    '0-30s': ['sendmoney', 'payment'],
    '30-60s': ['sendmoney', 'deposit', 'payment'],
    '60-90s': ['sendmoney', 'deposit', 'payment'],
    '90-120s': ['payment'],
};

const thresholds = {
    http_req_failed: ['rate < 0.01'],
    http_req_duration: ['p(95) < 1000'],
    checks: ['rate >= 0.99'],
};

for (const transaction of ['deposit', 'sendmoney', 'payment']) {
    thresholds[`http_req_failed{transaction:${transaction}}`] = ['rate < 0.01'];
    thresholds[`http_req_duration{transaction:${transaction}}`] = ['p(95) < 1000'];
    thresholds[`checks{transaction:${transaction}}`] = ['rate >= 0.99'];
    thresholds[`transaction_failures{transaction:${transaction}}`] = ['rate < 0.01'];
    thresholds[`transaction_checks{transaction:${transaction}}`] = ['rate >= 0.99'];
    thresholds[`transaction_response_time{transaction:${transaction}}`] = ['p(95) < 1000'];
    thresholds[`transaction_request_count{transaction:${transaction}}`] = ['count > 0'];
}

for (const [window, transactionTypes] of Object.entries(activeTransactionsByWindow)) {
    for (const transaction of transactionTypes) {
        const tags = `transaction:${transaction},window:${window}`;
        thresholds[`http_req_duration{${tags}}`] = ['p(95) < 1000'];
        thresholds[`checks{${tags}}`] = ['rate >= 0.99'];
        thresholds[`transaction_failures{${tags}}`] = ['rate < 0.01'];
        thresholds[`transaction_checks{${tags}}`] = ['rate >= 0.99'];
        thresholds[`transaction_response_time{${tags}}`] = ['p(95) < 1000'];
        thresholds[`transaction_request_count{${tags}}`] = ['count > 0'];
    }
}

export const options = {
    setupTimeout: '5m',
    scenarios: {
        dmoney_transactions: {
            executor: 'constant-vus',
            vus: users.length,
            duration: '2m',
            gracefulStop: '0s',
        },
    },
    thresholds,
};

function apiHeaders(token) {
    if (!X_AUTH_SECRET_KEY) {
        throw new Error('Set X_AUTH_SECRET_KEY in the environment before running this test');
    }

    const headers = {
        'Content-Type': 'application/json',
        'X-AUTH-SECRET-KEY': X_AUTH_SECRET_KEY,
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

function parseJson(response) {
    try {
        return response.json();
    } catch (error) {
        return null;
    }
}

function collectMessageText(part) {
    if (!part) {
        return '';
    }

    let text = '';
    if (part.body && part.body.data) {
        text += `${encoding.b64decode(part.body.data, 'rawurl', 's')}\n`;
    }
    if (part.parts) {
        for (const child of part.parts) {
            text += `${collectMessageText(child)}\n`;
        }
    }
    return text;
}

function extractOtp(message) {
    const snippet = message.snippet || '';
    const snippetOtp = snippet.match(/one[-\s]?time password[\s\S]{0,120}?\bis:\s*(\d{4})\b/i)
        || snippet.match(/one[-\s]?time password[\s\S]{0,120}?\b(\d{4})\b/i)
        || snippet.match(/(?:otp|verification code)[\s\S]{0,80}?\b(\d{4})\b/i);
    if (snippetOtp) {
        return snippetOtp[1];
    }

    const messageHeaders = (message.payload && message.payload.headers) || [];
    const subject = messageHeaders.find((header) => header.name.toLowerCase() === 'subject');
    const text = `${subject ? subject.value : ''}\n${collectMessageText(message.payload)}`
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ');
    const otpMatch = text.match(/one[-\s]?time password[\s\S]{0,120}?\b(\d{4})\b/i)
        || text.match(/(?:otp|verification code)[\s\S]{0,80}?\b(\d{4})\b/i)
        || text.match(/(\d{4})[\s\S]{0,40}?(?:otp|one[-\s]?time password|verification code)/i);

    return otpMatch ? otpMatch[1] : null;
}

function messageIsForUser(message, email) {
    const expectedEmail = email.toLowerCase();
    const headers = (message.payload && message.payload.headers) || [];
    return headers.some((header) => {
        const name = header.name.toLowerCase();
        return ['to', 'cc', 'delivered-to', 'x-original-to'].includes(name)
            && header.value.toLowerCase().includes(expectedEmail);
    });
}

function authenticateUsers(accessToken) {
    const gmailHeaders = { Authorization: `Bearer ${accessToken}` };
    const loginStartedAt = Date.now();
    const loginRequests = users.map((user) => ({
        method: 'POST',
        url: `${BASE_URL}${LOGIN_PATH}`,
        body: JSON.stringify({ email: user.email, password: user.password }),
        params: { headers: apiHeaders(), tags: { name: 'login', user: user.name } },
    }));
    const loginResponses = http.batch(loginRequests);
    const tokens = {};
    const otpUsers = [];

    for (let index = 0; index < users.length; index++) {
        const user = users[index];
        const response = loginResponses[index];
        const body = parseJson(response);

        if (response.status !== 200 || !body) {
            throw new Error(`${user.name} login failed with status ${response.status}`);
        }
        if (body.token) {
            tokens[user.name] = body.token;
        } else if (body.otpRequired === true) {
            otpUsers.push({ user, loginStartedAt, otp: null });
        } else {
            throw new Error(`${user.name} login response contained neither a token nor otpRequired=true`);
        }
    }

    const deadline = Date.now() + OTP_TIMEOUT_SECONDS * 1000;
    const diagnostics = {};
    for (const { user } of otpUsers) {
        diagnostics[user.name] = { messages: 0, fresh: 0, addressed: 0 };
    }

    while (otpUsers.some((entry) => !entry.otp) && Date.now() < deadline) {
        const waitingUsers = otpUsers.filter((entry) => !entry.otp);
        const listResponses = http.batch(waitingUsers.map(({ user, loginStartedAt: startedAt }) => ({
            method: 'GET',
            url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
                `after:${Math.floor(startedAt / 1000) - 5}`,
            )}&maxResults=25`,
            params: {
                headers: gmailHeaders,
                tags: { name: 'gmail-list-otp', user: user.name },
            },
        })));
        const messagesById = {};

        for (let index = 0; index < waitingUsers.length; index++) {
            const entry = waitingUsers[index];
            const response = listResponses[index];
            const body = parseJson(response);
            if (response.status !== 200 || !body) {
                throw new Error(`${entry.user.name} Gmail message search failed with status ${response.status}`);
            }

            diagnostics[entry.user.name].messages = Math.max(
                diagnostics[entry.user.name].messages,
                (body.messages || []).length,
            );
            for (const messageRef of body.messages || []) {
                if (!messagesById[messageRef.id]) {
                    messagesById[messageRef.id] = [];
                }
                messagesById[messageRef.id].push(entry);
            }
        }

        const messageIds = Object.keys(messagesById);
        if (messageIds.length > 0) {
            const messageResponses = http.batch(messageIds.map((id) => ({
                method: 'GET',
                url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
                params: {
                    headers: gmailHeaders,
                    tags: { name: 'gmail-read-otp' },
                },
            })));

            for (let index = 0; index < messageIds.length; index++) {
                const response = messageResponses[index];
                const message = parseJson(response);
                if (response.status !== 200 || !message) {
                    throw new Error(`Gmail message retrieval failed with status ${response.status}`);
                }

                for (const entry of messagesById[messageIds[index]]) {
                    if (entry.otp) {
                        continue;
                    }
                    const internalDate = Number(message.internalDate);
                    if (!Number.isFinite(internalDate) || internalDate < entry.loginStartedAt - 5000) {
                        continue;
                    }
                    diagnostics[entry.user.name].fresh++;
                    if (!messageIsForUser(message, entry.user.email)) {
                        continue;
                    }
                    diagnostics[entry.user.name].addressed++;
                    entry.otp = extractOtp(message);
                }
            }
        }

        if (otpUsers.some((entry) => !entry.otp) && Date.now() < deadline) {
            sleep(Math.min(OTP_POLL_INTERVAL_SECONDS, (deadline - Date.now()) / 1000));
        }
    }

    const missingOtpUsers = otpUsers.filter((entry) => !entry.otp);
    if (missingOtpUsers.length > 0) {
        const details = missingOtpUsers.map(({ user }) => {
            const counts = diagnostics[user.name];
            return `${user.name} (${user.email}: ${counts.messages} recent, ${counts.fresh} fresh, ` +
                `${counts.addressed} addressed)`;
        }).join('; ');
        throw new Error(
            `Could not find fresh OTP email(s) within ${OTP_TIMEOUT_SECONDS} seconds: ${details}. ` +
            'Confirm Gmail API access to the inbox and that each message is addressed to its configured user email.',
        );
    }

    const verifyUsers = otpUsers.filter((entry) => !tokens[entry.user.name]);
    const verifyResponses = http.batch(verifyUsers.map(({ user, otp }) => ({
        method: 'POST',
        url: `${BASE_URL}${VERIFY_OTP_PATH}`,
        body: JSON.stringify({ identifier: user.email, otp }),
        params: { headers: apiHeaders(), tags: { name: 'verify-otp', user: user.name } },
    })));

    for (let index = 0; index < verifyUsers.length; index++) {
        const user = verifyUsers[index].user;
        const response = verifyResponses[index];
        const body = parseJson(response);
        if (response.status !== 200 || !body || !body.token) {
            const message = body && (body.message || body.error);
            throw new Error(
                `${user.name} OTP verification failed with status ${response.status}${message ? `: ${message}` : ''}`,
            );
        }
        tokens[user.name] = body.token;
    }

    return tokens;
}

export function setup() {
    if (!BASE_URL) {
        throw new Error('Set BASE_URL to your DMoney API base URL');
    }
    if (!X_AUTH_SECRET_KEY) {
        throw new Error('Set X_AUTH_SECRET_KEY in the environment before running this test');
    }
    if (!GMAIL_ACCESS_TOKEN) {
        throw new Error('Set GMAIL_ACCESS_TOKEN to the OAuth 2.0 Playground access token for Gmail OTP retrieval');
    }
    if (!Number.isFinite(PAUSE_SECONDS) || PAUSE_SECONDS < 0) {
        throw new Error('PAUSE_SECONDS must be a non-negative number');
    }
    if (!Number.isFinite(OTP_TIMEOUT_SECONDS) || OTP_TIMEOUT_SECONDS <= 0) {
        throw new Error('OTP_TIMEOUT_SECONDS must be a positive number');
    }
    if (!Number.isFinite(OTP_POLL_INTERVAL_SECONDS) || OTP_POLL_INTERVAL_SECONDS <= 0) {
        throw new Error('OTP_POLL_INTERVAL_SECONDS must be a positive number');
    }
    if (!Number.isFinite(AMOUNT) || AMOUNT < 10 || AMOUNT > 10000) {
        throw new Error('AMOUNT must be between 10 and 10000');
    }

    for (const user of users) {
        if (!user.email || !user.password || !user.account) {
            throw new Error(`Set the email, password, and account number for ${user.name}`);
        }
    }
    const tokens = authenticateUsers(GMAIL_ACCESS_TOKEN);
    return { tokens };
}

export default function (data) {
    const user = users[__VU - 1];
    if (!user || !data.tokens[user.name]) {
        throw new Error(`No authenticated user token is available for VU ${__VU}`);
    }

    const windowIndex = Math.min(3, Math.floor(exec.scenario.progress * 4));
    const window = `${windowIndex * 30}-${(windowIndex + 1) * 30}s`;
    const actionName = schedules[user.name][windowIndex];

    if (!actionName) {
        sleep(PAUSE_SECONDS);
        return;
    }

    const transaction = transactions[actionName];
    const tags = { transaction: transaction.type, window };
    const response = http.post(
        `${BASE_URL}${transaction.path}`,
        JSON.stringify({
            from_account: users.find((candidate) => candidate.name === transaction.from).account,
            to_account: users.find((candidate) => candidate.name === transaction.to).account,
            amount: AMOUNT,
        }),
        {
            headers: apiHeaders(data.tokens[user.name]),
            tags: {
                name: transaction.path,
                transaction: transaction.type,
                user: user.name,
                window,
            },
        },
    );

    const body = parseJson(response);
    const statusIsExpected = response.status === 201;
    const messageIsExpected = Boolean(body && body.message === transaction.expectedMessage);
    const transactionIdIsPresent = Boolean(body && typeof body.trnxId === 'string' && body.trnxId.trim());
    const transactionSucceeded = statusIsExpected && messageIsExpected && transactionIdIsPresent;

    check(
        response,
        {
            [`${transaction.type}: expected HTTP 201`]: () => statusIsExpected,
            [`${transaction.type}: expected success message`]: () => messageIsExpected,
            [`${transaction.type}: transaction ID returned`]: () => transactionIdIsPresent,
        },
        tags,
    );

    transactionResponseTime.add(response.timings.duration, tags);
    transactionRequestCount.add(1, tags);
    transactionFailures.add(!transactionSucceeded, tags);
    transactionChecks.add(transactionSucceeded, tags);

    sleep(PAUSE_SECONDS);
}

function taggedMetric(data, name, tags) {
    const expectedTags = Object.entries(tags).map(([key, value]) => `${key}:${value}`);
    for (const [metricName, metric] of Object.entries(data.metrics)) {
        if (!metricName.startsWith(`${name}{`) || !metricName.endsWith('}')) {
            continue;
        }
        const actualTags = metricName
            .slice(name.length + 1, -1)
            .replace(/"/g, '')
            .split(',')
            .map((tag) => tag.trim());
        if (actualTags.length === expectedTags.length && expectedTags.every((tag) => actualTags.includes(tag))) {
            return metric;
        }
    }
    return null;
}

function metricValue(metric, key, multiplier) {
    const value = metric && metric.values ? metric.values[key] : null;
    return typeof value === 'number' ? value * (multiplier || 1) : null;
}

function displayNumber(value, decimals) {
    return value === null ? 'n/a' : value.toFixed(decimals);
}

export function handleSummary(data) {
    const report = {
        duration: '2m',
        apis: {},
    };
    const lines = [
        'DMoney transaction performance comparison',
        'Duration: 2 minutes',
        '',
        'Overall API results',
        'API | Requests | Throughput (req/s) | Avg (ms) | p95 (ms) | Failure rate | Checks passed',
        '--- | ---: | ---: | ---: | ---: | ---: | ---:',
    ];

    for (const transaction of ['deposit', 'sendmoney', 'payment']) {
        const tags = { transaction };
        const count = metricValue(taggedMetric(data, 'transaction_request_count', tags), 'count', 1);
        const throughput = metricValue(taggedMetric(data, 'transaction_request_count', tags), 'rate', 1);
        const duration = taggedMetric(data, 'transaction_response_time', tags);
        const failureRate = metricValue(taggedMetric(data, 'transaction_failures', tags), 'rate', 100);
        const checksPassed = metricValue(taggedMetric(data, 'transaction_checks', tags), 'rate', 100);
        report.apis[transaction] = {
            requests: count,
            throughputPerSecond: throughput,
            averageResponseTimeMs: metricValue(duration, 'avg', 1),
            p95ResponseTimeMs: metricValue(duration, 'p(95)', 1),
            failureRatePercent: failureRate,
            checksPassedPercent: checksPassed,
            windows: {},
        };
        lines.push(
            `${transaction} | ${displayNumber(count, 0)} | ${displayNumber(throughput, 2)} | ${displayNumber(metricValue(duration, 'avg', 1), 2)} | ${displayNumber(metricValue(duration, 'p(95)', 1), 2)} | ${displayNumber(failureRate, 2)}% | ${displayNumber(checksPassed, 2)}%`,
        );
    }

    lines.push('', 'Response time and failures by 30-second window');
    lines.push('Window | API | Requests | Throughput (req/s) | Avg (ms) | p95 (ms) | Failure rate');
    lines.push('--- | --- | ---: | ---: | ---: | ---: | ---:');

    for (const [window, transactionTypes] of Object.entries(activeTransactionsByWindow)) {
        for (const transaction of transactionTypes) {
            const tags = { transaction, window };
            const count = metricValue(taggedMetric(data, 'transaction_request_count', tags), 'count', 1);
            const throughput = metricValue(taggedMetric(data, 'transaction_request_count', tags), 'rate', 1);
            const duration = taggedMetric(data, 'transaction_response_time', tags);
            const failureRate = metricValue(taggedMetric(data, 'transaction_failures', tags), 'rate', 100);
            report.apis[transaction].windows[window] = {
                requests: count,
                throughputPerSecond: throughput,
                averageResponseTimeMs: metricValue(duration, 'avg', 1),
                p95ResponseTimeMs: metricValue(duration, 'p(95)', 1),
                failureRatePercent: failureRate,
            };
            lines.push(
                `${window} | ${transaction} | ${displayNumber(count, 0)} | ${displayNumber(throughput, 2)} | ${displayNumber(metricValue(duration, 'avg', 1), 2)} | ${displayNumber(metricValue(duration, 'p(95)', 1), 2)} | ${displayNumber(failureRate, 2)}%`,
            );
        }
    }

    lines.push('', 'A successful transaction requires HTTP 201, the documented success message, and a non-empty trnxId.');
    return {
        stdout: `${lines.join('\n')}\n`,
        'dmoney-performance-summary.json': JSON.stringify(report, null, 2),
    };
}
export function htmlReportGen(data) {
  return {
    "./reports/report.html": htmlReport(data),
  };
}
