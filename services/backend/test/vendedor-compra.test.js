// El comprador elige el vendedor que lo atendio (opcional) desde la web.

import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";

const rifa = (store, slug) => store.createRaffle({
  slug, title: slug, prize: "P", priceCents: 400000, currency: "COP",
  numberRange: { min: 1, max: 99 }, startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 864e5).toISOString(), minSoldToDraw: 0, status: "ACTIVE",
});
const buyer = { firstName: "Ana", lastName: "Ruiz", phone: "3001112233" };

test("sellersForRaffle solo lista los asignados y solo expone id + nombre", () => {
  const store = createStore();
  rifa(store, "a"); rifa(store, "b");
  const v1 = store.createAdmin({ email: "v1@x.com", passwordHash: "x", role: "OPERATOR", fullName: "Uno" });
  const v2 = store.createAdmin({ email: "v2@x.com", passwordHash: "x", role: "OPERATOR", fullName: "Dos" });
  store.assignSellerRaffles(v1.id, ["a"]);
  store.assignSellerRaffles(v2.id, ["b"]);

  const lista = store.sellersForRaffle("a");
  assert.deepEqual(lista, [{ id: v1.id, name: "Uno" }]);
  assert.ok(!("email" in lista[0]), "nunca el correo del vendedor");
});

test("la orden guarda el vendedor elegido y el admin lo ve", () => {
  const store = createStore();
  rifa(store, "a");
  const v = store.createAdmin({ email: "v@x.com", passwordHash: "x", role: "OPERATOR", fullName: "Maria" });
  store.assignSellerRaffles(v.id, ["a"]);

  store.reserveMany("a", [5, 6], buyer, "MANUAL", { id: v.id, name: "Maria" });
  const filas = store.adminPurchases("a", "PENDING");
  assert.equal(filas.length, 2);
  assert.ok(filas.every((f) => f.sellerName === "Maria"));
});

test("sin vendedor la compra funciona igual (ninguno)", () => {
  const store = createStore();
  rifa(store, "a");
  const p = store.reserve("a", 7, buyer, "MANUAL");
  assert.equal(p.sellerId, null);
});
