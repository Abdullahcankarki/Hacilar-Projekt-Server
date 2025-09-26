process.env.JWT_SECRET = "supersecretkey";
import request from "supertest";
import app from "../../src/app"; // Passe den Pfad ggf. an
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const token = jwt.sign(
  {
    id: "adminid123",
    name: "Admin",
    role: ["admin"],
  },
  JWT_SECRET
);

test("POST /api/mitarbeiter – sollte einen neuen Mitarbeiter anlegen", async () => {
  const testee = request(app);
  const res = await testee
    .post("/api/mitarbeiter")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "Max Mustermann",
      password: "pass123",
      email: "max@test.de",
      rollen: ["verkauf"],
    });

  expect(res.status).toBe(201);
  expect(res.body.name).toBe("max mustermann");
  expect(res.body.email).toBe("max@test.de");
});

test("POST /api/mitarbeiter – sollte bei fehlendem Token 401 zurückgeben", async () => {
  const testee = request(app);
  const res = await testee.post("/api/mitarbeiter").send({
    name: "Fehler",
    password: "123456",
  });

  expect(res.status).toBe(401);
});

test("GET /api/mitarbeiter – sollte alle Mitarbeiter zurückgeben", async () => {
  const testee = request(app);
  const res = await testee.get("/api/mitarbeiter").set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test("POST /api/mitarbeiter/login – sollte Login ablehnen bei ungültigen Daten", async () => {
  const testee = request(app);
  const res = await testee.post("/api/mitarbeiter/login").send({
    name: "NichtVorhanden",
    password: "falsch",
  });

  expect(res.status).toBe(401);
});

test("GET /api/mitarbeiter/:id – sollte einen Mitarbeiter per ID zurückgeben", async () => {
  const testee = request(app);
  const createRes = await testee
    .post("/api/mitarbeiter")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "Detail Nutzer",
      password: "detail123",
      email: "detail@test.de",
      rollen: ["fahrer"],
    });
  const createdId = createRes.body.id || createRes.body._id;

  const res = await testee.get(`/api/mitarbeiter/${createdId}`).set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.name).toBe("detail nutzer");
});

test("GET /api/mitarbeiter/:id – sollte Fehler liefern bei ungültiger ID", async () => {
  const testee = request(app);
  const res = await testee.get("/api/mitarbeiter/123").set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(400);
});

test("PUT /api/mitarbeiter/:id – sollte Mitarbeiterdaten ändern", async () => {
  const testee = request(app);
  const createRes = await testee
    .post("/api/mitarbeiter")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "Update Nutzer",
      password: "update123",
      rollen: ["lager"],
    });
  const updateId = createRes.body.id || createRes.body._id;

  const res = await testee
    .put(`/api/mitarbeiter/${updateId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Update Neuer Name" });

  expect(res.status).toBe(200);
  expect(res.body.name).toBe("update neuer name");
});

test("PUT /api/mitarbeiter/:id – sollte bei ungültiger ID Fehler geben", async () => {
  const testee = request(app);
  const res = await testee
    .put("/api/mitarbeiter/abc123")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Fehler" });

  expect(res.status).toBe(400);
});

test("DELETE /api/mitarbeiter/:id – sollte Mitarbeiter löschen", async () => {
  const testee = request(app);
  const createRes = await testee
    .post("/api/mitarbeiter")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "Lösch Nutzer",
      password: "delete123",
      rollen: ["kontrolle"],
    });
  const deleteId = createRes.body.id || createRes.body._id;

  const res = await testee.delete(`/api/mitarbeiter/${deleteId}`).set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe("Mitarbeiter gelöscht");
});

test("DELETE /api/mitarbeiter/:id – sollte Fehler bei ungültiger ID geben", async () => {
  const testee = request(app);
  const res = await testee.delete("/api/mitarbeiter/123abc").set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(400);
});

test("POST /api/mitarbeiter/login success – sollte erfolgreich einloggen", async () => {
  const testee = request(app);
  await testee
    .post("/api/mitarbeiter")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "LoginNutzer",
      password: "login123",
      rollen: ["verkauf"],
    });

  const res = await testee.post("/api/mitarbeiter/login").send({
    name: "LoginNutzer",
    password: "login123",
  });

  expect(res.status).toBe(200);
  expect(res.body.token).toBeDefined();
});

test("POST /api/mitarbeiter/login success – sollte 400 liefern bei leerem Body", async () => {
  const testee = request(app);
  const res = await testee.post("/api/mitarbeiter/login").send({});

  expect(res.status).toBe(400);
});