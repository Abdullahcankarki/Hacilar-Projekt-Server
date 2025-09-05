import express from 'express';
import "express-async-errors"; // needs to be imported before routers and other stuff!
import cors from 'cors';
import artikelRouter from './routes/ArtikelRoutes';
import artikelPositionRouter from './routes/ArtikelPositionRoutes';
import auftragRouter from './routes/AuftragRoutes';
import kundenPreisRouter from './routes/KundenPreisRoutes';
import kundeRouter from './routes/KundeRoutes';
import verkaeuferRouter from './routes/MitarbeiterRoutes';
import loginRouter from './routes/LoginRouter';
import zerlegeRouter from './routes/ZerlegeAuftragRoutes';
import fahrzeugRouter from './routes/FahrzeugRoutes';
import regionRuleRouter from './routes/RegionRuleRoutes';
import reihenfolgeVorlageRouter from './routes/ReihenfolgeVorlageRoutes';
import tourRouter from './routes/TourRoutes';
import tourStopRouter from './routes/TourStopRoutes';
import samsara from './api/samsara'

const app = express();

// Middleware:
app.use('*', express.json()) // vgl. Folie 138

// Routes
// TODO: Registrieren Sie hier die weiteren Router:
const allowedOrigins = [
  'http://localhost:3000',
  'https://hacilar-api.onrender.com', // dein Frontend in der Cloud
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Nicht erlaubte Herkunft: ' + origin));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' })); // oder mehr, je nach Bedarf
app.use('/api', samsara);
app.use("/api/artikel", artikelRouter);
app.use("/api/artikelPosition", artikelPositionRouter);
app.use("/api/auftrag", auftragRouter);
app.use("/api/kundenPreis", kundenPreisRouter);
app.use("/api/kunde", kundeRouter);
app.use("/api/mitarbeiter", verkaeuferRouter);
app.use("/api/zerlege", zerlegeRouter);
app.use("/api/login", loginRouter);
app.use("/api/fahrzeug", fahrzeugRouter);
app.use("/api/region-rule", regionRuleRouter);
app.use("/api/reihenfolge-vorlage", reihenfolgeVorlageRouter);
app.use("/api/tour", tourRouter)
app.use("/api/tour-stop", tourStopRouter)


export default app;