import express from 'express';
import "express-async-errors"; // needs to be imported before routers and other stuff!

const app = express();

// Middleware:
app.use('*', express.json()) // vgl. Folie 138

// Routes
// TODO: Registrieren Sie hier die weiteren Router:


export default app;