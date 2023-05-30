// npm run build && node dist/scripts/test.js

const stream = require("node:stream");
const {pipeline: pipelinePromise} = require("node:stream/promises");

const axios = require("axios");
const express = require("express");
const fs = require("fs");

/**
 * Read database host, port, database, user, and password from a
 * config file.
 */
const config = require("./config.js");

/**
 * When true, an HTTP request will be timed out while data is
 * still being piped from a query stream to the client.
 * 
 * This will result in the route handler exiting without the
 * database connection ever being closed.
 */
const RequestAbortError = (
    process.argv.indexOf("abort-request") >= 0
);
/**
 * When true, a transform stream that streamed query rows are
 * being piped to will fail partway through with a call to
 * `this.emit("error", error)`.
 * 
 * This will result in the route handler exiting without the
 * database connection ever being closed.
 */
const TransformStreamEmitError = (
    process.argv.indexOf("transform-emit-error") >= 0
);

/**
 * Transform stream error, but via `callback(error)`.
 * This causes the same failure as emitting an error event.
 */
const TransformStreamCallbackError = (
    process.argv.indexOf("transform-callback-error") >= 0
);
/**
 * Transform stream error, but via `throw error`.
 * This is an unrecoverable error that crashes node.
 */
const TransformStreamThrowError = (
    process.argv.indexOf("transform-throw-error") >= 0
);

const AnyError = (
    RequestAbortError ||
    TransformStreamThrowError ||
    TransformStreamCallbackError ||
    TransformStreamEmitError
);

console.log("RequestAbortError:", RequestAbortError);
console.log("TransformStreamEmitError:", TransformStreamEmitError);
console.log("TransformStreamCallbackError:", TransformStreamCallbackError);
console.log("TransformStreamThrowError:", TransformStreamThrowError);

const DatabaseSchema = `
drop table if exists test;
create table test (
    "id" varchar not null,
    primary key("id")
);
`;

async function getTestApp() {
    console.log("Acquiring database connection");
    const knex = require("knex")({
        client: "pg",
        connection: {
            host: config.host || "127.0.0.1",
            port: Number(config.port) || 5432,
            database: config.database || "",
            user: config.user || "",
            password: config.password || "",
        },
    });

    console.log("Initializing database schema");
    await knex.raw(DatabaseSchema);

    console.log("Inserting data");
    const insertions = [];
    const terms = [
        "ape", "bun", "cut", "doc",
        "elk", "fit", "gas", "hop",
        "ink", "joy", "kin", "lye",
    ];
    let n = 0;
    for(const i of terms) {
        for(const j of terms) {
            for(const k of terms) {
                insertions.push({"id": `${i}-${j}-${k}`});
                if(n++ == 20) {
                    insertions.push({"id": "error"});
                }
            }
        }
    }
    await knex("test").insert(insertions);
    
    const app = express();
    
    app.get("/test1", async (request, response) => {
        console.log("Writing test output");
        const knexStream = knex("test").select("id").stream();
        const transformStream = new stream.Transform({
            writableObjectMode: true,
            transform: function(chunk, encoding, callback) {
                // console.log("transform chunk", chunk);
                if(chunk["id"] === "error") {
                    if(TransformStreamThrowError) {
                        throw new Error("Thrown error");
                    }
                    else if(TransformStreamCallbackError) {
                        callback(new Error("Callback error"), "");
                    }
                    else if(TransformStreamEmitError) {
                        this.emit("error", new Error("Emitted error"));
                    }
                    else {
                        callback(null, JSON.stringify(chunk) + "\n");
                    }
                }
                else {
                    callback(null, JSON.stringify(chunk) + "\n");
                }
            },
        });
        request.on("close", () => {
            // https://github.com/knex/knex/issues/615
            knexStream.end();
        });
        response.set({
            "Content-disposition": `attachment; filename="test.csv"`,
            "Content-Type": "text/csv",
        });
        response.status(200);
        try {
            await pipelinePromise([
                knexStream,
                transformStream,
                response,
            ], {
                end: true,
            });
        }
        catch(error) {
            console.error("Pineline error");
            console.error(error);
        }
        response.end();
    });
    
    app.get("/test2", async (request, response) => {
        console.log("Reinitializing database schema");
        if(AnyError) {
            console.log("BUG: Interrupted stream query causes hanging here");
        }
        await knex.raw(DatabaseSchema);
        console.log("Finished reinitializing database schema");
        
        console.log("Verify table is empty now");
        const rows = await knex("test").select("id");
        console.log("Test rows result:", rows);
        if(rows.length) {
            throw new Error();
        }

        console.log("All done");
        response.status(200).end();
    });
    
    return app;
}

async function test() {
    const port = 8870;
    const app = await getTestApp();
    app.listen(port, function() {
        console.log(`Now listening on port ${port}.`);
    });
    
    console.log("Hitting test1 express route");
    try {
        const responseContent = await axios(`http://localhost:${port}/test1`, {
            timeout: RequestAbortError ? 5 : undefined,
        });
        console.log("test1 response status:", responseContent.status);
    }
    catch(error) {
        console.error("Error hitting test1");
        if(error.message === "socket hang up") {
            console.error(error.message, "...");
        }
        else if(error.message.startsWith("timeout") &&
            error.message.endsWith("exceeded")
        ) {
            console.error(error.message, "...");
        }
        else {
            console.error(error);
        }
    }
    console.log("Hitting test2 express route");
    await axios(`http://localhost:${port}/test2`);
    
    console.log("Both test1 and test2 routes were hit");
}

test().then(() => {
    console.log("Finished");
    process.exit(0);
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
