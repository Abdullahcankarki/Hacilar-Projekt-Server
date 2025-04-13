import express from 'express';
import "express-async-errors"; // needs to be imported before routers and other stuff!
import cors from 'cors';
import artikelRouter from './routes/ArtikelRoutes';
import artikelPositionRouter from './routes/ArtikelPositionRoutes';
import auftragRouter from './routes/AuftragRoutes';
import kundenPreisRouter from './routes/KundenPreisRoutes';
import kundeRouter from './routes/KundeRoutes';
import verkaeuferRouter from './routes/VerkaeuferRoutes';
import loginRouter from './routes/LoginRouter';

const app = express();

// Middleware:
app.use('*', express.json()) // vgl. Folie 138

// Routes
// TODO: Registrieren Sie hier die weiteren Router:
app.use(cors());
app.use("/api/artikel", artikelRouter);
app.use("/api/artikelPosition", artikelPositionRouter);
app.use("/api/auftrag", auftragRouter);
app.use("/api/kundenPreis", kundenPreisRouter);
app.use("/api/kunde", kundeRouter);
app.use("/api/verkaeufer", verkaeuferRouter);
app.use("/api/login", loginRouter)


export default app;