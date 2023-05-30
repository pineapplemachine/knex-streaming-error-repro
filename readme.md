This is a repro case for an issue with Knex streaming queries.

The issue has been reported here: https://github.com/knex/knex/issues/5589

Please follow these steps to observe the issue.

Clone this repository and install dependencies:

```
git clone github.com/pineapplemachine/knex-streaming-error-repro
cd knex-streaming-error-repro
yarn install
```

Create a file named `config.js` in the root repository directory containing credentials to connect to a postgres database. Note that a table named `test` will be created in this database, and if any such table already exists then it will be dropped upon running the test script.

``` js
// config.js
module.exports = {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "[database name]",
    "user": "[username]",
    "password": "[password]",
};
```

First run the test case without any simulated errors, to ensure that the entire test can run as expected when no error occurs. Your console output should appear similar to the example, and should read "Finished" at the end.

```
$ node index.js
RequestAbortError: false
TransformStreamEmitError: false
TransformStreamCallbackError: false
TransformStreamThrowError: false
Acquiring database connection
Initializing database schema
Inserting data
Hitting test1 express route
Now listening on port 8870.
Writing test output
test1 response status: 200
Hitting test2 express route
Reinitializing database schema
Finished reinitializing database schema
Verify table is empty now
Test rows result: []
All done
Both test1 and test2 routes were hit
Finished
```

Now run the test case simulating an aborted request to an express route. If the expected failure case occurs, then the message `BUG: Interrupted stream query causes hanging here` will be printed to the console and you will need to terminate the script, e.g. with ctrl+C.

_This is not deterministic, because it depends on a request timeout to abort the request while rows are still being streamed. Please try a few times if the expected failure does not happen the first time. If necessary, the timeout can be changed on L194 of the test script._

```
$ node index.js abort-request
RequestAbortError: true
TransformStreamEmitError: false
TransformStreamCallbackError: false
TransformStreamThrowError: false
Acquiring database connection
Initializing database schema
Inserting data
Hitting test1 express route
Now listening on port 8870.
Writing test output
Error hitting test1
timeout of 5ms exceeded ...
Hitting test2 express route
Pineline error
Error [ERR_STREAM_PREMATURE_CLOSE]: Premature close
    at new NodeError (node:internal/errors:399:5)
    at ServerResponse.<anonymous> (node:internal/streams/pipeline:412:14)
    at ServerResponse.emit (node:events:524:35)
    at emitCloseNT (node:_http_server:980:10)
    at Socket.onServerResponseClose (node:_http_server:272:5)
    at Socket.emit (node:events:524:35)
    at TCP.<anonymous> (node:net:332:12) {
  code: 'ERR_STREAM_PREMATURE_CLOSE'
}
Reinitializing database schema
BUG: Interrupted stream query causes hanging here
```

You can simulate some additional failure cases with these commands:

```
# Exposes the same root issue via emitting an error in a transform stream
node index.js transform-emit-error

# Same as above, but uses the transform stream's callback error argument
node index.js transform-callback-error

# Unhandled exception terminates the process during query streaming
node index.js transform-throw-error
```
