import * as appInsights from 'applicationinsights'
import { envs } from './envs';
import winston from 'winston';

appInsights
    .setup(envs.APPINSIGHTS_CONNECTION_STRING)
    .setSendLiveMetrics(true)
    .setAutoCollectConsole(false)
    .start();

const aiClient = appInsights.defaultClient

const appInsightsTransport = new winston.transports.Console({
    level: "info",
    format: winston.format.printf(({level, message, timestamp}) =>{
        const MessageAi = `[${level} ${message} ${timestamp}]`
        aiClient.trackTrace({
            message: MessageAi,
            properties: { timestamp }
        });
        return MessageAi
    })
});

export const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        appInsightsTransport
    ]
});