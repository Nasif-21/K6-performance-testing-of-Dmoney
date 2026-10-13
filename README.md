# <div align ="center">K6 performance testing Dmoney Website on a secnario 
## Project overview:
This project focuses on performance testing of DMoney transaction APIs using k6, an open-source load testing tool. 
The test simulates real-world financial transactions involving six authenticated users: two agents, two customers, and two merchants.
Over a two-minute test duration, the workload is divided into four 30-second phases, simulating concurrent deposits, money transfers, and merchant payments according to predefined transaction scenarios.
The project evaluates the performance, reliability, and responsiveness of three transaction APIs: ```/transaction/deposit```, ```/transaction/sendmoney```, and ```/transaction/payment```. 
Each user authenticates using their own credentials, and appropriate k6 checks validate HTTP status codes, transaction success, transaction IDs, and expected success messages.

Performance metrics, including response time, throughput, request failure rate, and performance degradation under changing workloads, are analyzed to compare the three APIs.
Configurable performance thresholds ensure that the failed request rate remains below 1%, the 95th-percentile response time stays below 1000 ms, and transaction checks pass at least 99% of the time.
Separate thresholds are configured for each transaction API to identify potential bottlenecks and assess overall system stability and reliability.

## Tech Stack:
* K6
* Javascript
* Google Gmail API

## Project goals:
* Expected HTTP status code
* Transaction request is successful
* Transaction ID is returned
* Expected success message is returned
* Failed request rate is less than 1%
* p(95) response time is below 1000 ms
* Transaction checks pass at least 99% of the time
