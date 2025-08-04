import express from 'express';
import { SerialPortStream } from '@serialport/stream';
import { autoDetect } from '@serialport/bindings-cpp';
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

const app = express();

// let aktuellesGewicht = '—';

// const Binding = autoDetect();

// const waagenPort = new SerialPortStream({
//   binding: Binding,
//   path: '/dev/tty.usbserial-1234', // anpassen je nach System
//   baudRate: 9600,
// });

// waagenPort.on('data', (data: Buffer) => {
//   const raw = data.toString().trim();
//   const match = raw.match(/([0-9]+\.[0-9]+)/);
//   if (match) {
//     aktuellesGewicht = match[1];
//     console.log('Gewicht:', aktuellesGewicht);
//   }
// });

// app.get('/api/gewicht', (req, res) => {
//   res.json({ gewicht: aktuellesGewicht });
// });

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
app.use("/api/artikel", artikelRouter);
app.use("/api/artikelPosition", artikelPositionRouter);
app.use("/api/auftrag", auftragRouter);
app.use("/api/kundenPreis", kundenPreisRouter);
app.use("/api/kunde", kundeRouter);
app.use("/api/mitarbeiter", verkaeuferRouter);
app.use("/api/zerlege", zerlegeRouter);
app.use("/api/login", loginRouter)


export default app;