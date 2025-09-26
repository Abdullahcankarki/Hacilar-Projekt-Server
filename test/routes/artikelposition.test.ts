process.env.JWT_SECRET = "supersecretkey";
import request from "supertest";
import app from "../../src/app";
import jwt from "jsonwebtoken";
import { ArtikelPosition } from "../../src/model/ArtikelPositionModel";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const token = jwt.sign(
  {
    id: "testuser123",
    role: ["admin"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
  JWT_SECRET
);

let createdId: string;

test("POST /api/artikelposition – sollte 400 bei fehlender Menge liefern", async () => {
  const testee = request(app);
  const res = await testee
    .post("/api/artikelposition")
    .set("Authorization", `Bearer ${token}`)
    .send({
      artikel: "60f1b9c2e1d1e2a1b8e4d3c1",
      einheit: "kg",
      einzelpreis: 5,
    });

  expect(res.status).toBe(400);
});

test("POST /api/artikelposition – sollte Artikelposition korrekt speichern", async () => {
  const testee = request(app);
  const res = await testee
    .post("/api/artikelposition")
    .set("Authorization", `Bearer ${token}`)
    .send({
      artikel: "60f1b9c2e1d1e2a1b8e4d3c1",
      menge: 10,
      einheit: "kg",
      einzelpreis: 5,
      zerlegung: true,
      vakuum: true,
      bemerkung: "Testeintrag",
    });

  expect([200, 201]).toContain(res.status);
  expect(res.body).toHaveProperty("artikel");
  expect(res.body).toHaveProperty("menge", 10);
  expect(res.body).toHaveProperty("einheit", "kg");
  expect(res.body).toHaveProperty("einzelpreis", 5);
  expect(res.body).toHaveProperty("zerlegung", true);
  expect(res.body).toHaveProperty("vakuum", true);
  createdId = res.body._id || res.body.id;
});

test("GET /api/artikelposition – sollte alle Artikelpositionen zurückgeben", async () => {
  const testee = request(app);
  const res = await testee
    .get("/api/artikelposition")
    .set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test("GET /api/artikelposition/:id – sollte 400 bei ungültiger ID liefern", async () => {
  const testee = request(app);
  const res = await testee
    .get("/api/artikelposition/123")
    .set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(400);
});

test("GET /api/artikelposition/:id – sollte eine Artikelposition zurückgeben", async () => {
  const testee = request(app);
  const res = await testee
    .get(`/api/artikelposition/${createdId}`)
    .set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("artikel");
});

test("PUT /api/artikelposition/:id – sollte 400 bei ungültiger ID liefern", async () => {
  const testee = request(app);
  const res = await testee
    .put("/api/artikelposition/123abc")
    .set("Authorization", `Bearer ${token}`)
    .send({ menge: 15 });

  expect(res.status).toBe(400);
});

test("PUT /api/artikelposition/:id – sollte Artikelposition ändern", async () => {
  const testee = request(app);
  const res = await testee
    .put(`/api/artikelposition/${createdId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ menge: 99, einzelpreis: 9 });

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("menge", 99);
  expect(res.body).toHaveProperty("einzelpreis", 9);
});

test("DELETE /api/artikelposition/:id – sollte 400 bei ungültiger ID liefern", async () => {
  const testee = request(app);
  const res = await testee
    .delete("/api/artikelposition/123abc")
    .set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(400);
});

test("DELETE /api/artikelposition/:id – sollte Artikelposition löschen", async () => {
  const testee = request(app);
  const res = await testee
    .delete(`/api/artikelposition/${createdId}`)
    .set("Authorization", `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("message", "Artikelposition gelöscht");
});

test("POST /api/artikelposition – sollte 400 bei ungültigem Datentyp liefern", async () => {
  const testee = request(app);
  const res = await testee
    .post("/api/artikelposition")
    .set("Authorization", `Bearer ${token}`)
    .send({
      artikel: "60f1b9c2e1d1e2a1b8e4d3c1",
      menge: "zehn",
      einheit: "kg",
      einzelpreis: 5,
    });

  expect(res.status).toBe(400);
});

test("PUT /api/artikelposition/:id – sollte 400 bei ungültigem Datentyp liefern", async () => {
  const testee = request(app);
  const res = await testee
    .put(`/api/artikelposition/${createdId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ menge: "neunundneunzig" });

  expect(res.status).toBe(400);
});
