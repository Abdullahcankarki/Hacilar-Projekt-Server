/* istanbul ignore file */

import dotenv from "dotenv";
dotenv.config() // read ".env"

import http from "http";
import mongoose from 'mongoose';
import app from "./app";
import { logger } from "./logger"

async function setup() {

    let mongodURI = process.env.DB_CONNECTION_STRING;
    if (!mongodURI) {
        logger.error(`Cannot start, no database configured. Set environment variable DB_CONNECTION_STRING. Use "memory" for MongoMemoryServer`);
        process.exit(1);
    }
    if (mongodURI === "memory") {
        logger.info("Start MongoMemoryServer")
        const MMS = await import('mongodb-memory-server')
        const mongo = await MMS.MongoMemoryServer.create();
        mongodURI = mongo.getUri();
    }

    logger.info(`Connect to mongod at ${mongodURI}`)
    await mongoose.connect(mongodURI);

    const port = process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT) : 3000;
    const httpServer = http.createServer(app);
    httpServer.listen(port, () => {
        logger.info(`Listening for HTTP at http://localhost:${port}`);
    });

};

setup();