import { create } from "zustand";
import type { LocalCustomer, LocalProduct } from "@/lib/localDb";

export type CartLine = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type PaymentSplit = {
  method: string;
  amount: number;
  reference?: string;
};

/** Snapshot at checkout / loaded from DB for printing */
export type LastSaleCustomerSnapshot = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  type: string;
};

export type LastSaleReceipt = {
  invoiceNumber: string;
  createdAt: string;
  payments: PaymentSplit[];
  lines: CartLine[];
  total: number;
  customer?: LastSaleCustomerSnapshot | null;
  /** EGP value from loyalty point redemption */
  loyaltyDiscount?: number;
  /** Invoice memo (from admin or synced sale) */
  notes?: string | null;
  /** Local IndexedDB sale id when this receipt was built from history */
  sourceSaleId?: string;
};

export type HeldTransaction = {
  id: string;
  heldAt: string;
  query: string;
  cart: CartLine[];
  paymentSplits: PaymentSplit[];
  selectedCustomer: LocalCustomer | null;
  redeemPoints: number;
};

type PosState = {
  query: string;
  status: string;
  found: LocalProduct | null;
  cart: CartLine[];
  paymentSplits: PaymentSplit[];
  customerQuery: string;
  customerResults: LocalCustomer[];
  selectedCustomer: LocalCustomer | null;
  redeemPoints: number;
  heldTransactions: HeldTransaction[];
  saving: boolean;
  lastSale: LastSaleReceipt | null;
  setQuery: (value: string) => void;
  setStatus: (value: string) => void;
  setFound: (value: LocalProduct | null) => void;
  setPaymentSplits: (value: PaymentSplit[]) => void;
  setCustomerQuery: (value: string) => void;
  setCustomerResults: (value: LocalCustomer[]) => void;
  setSelectedCustomer: (value: LocalCustomer | null) => void;
  setRedeemPoints: (value: number) => void;
  setHeldTransactions: (value: HeldTransaction[]) => void;
  setSaving: (value: boolean) => void;
  setLastSale: (value: LastSaleReceipt | null) => void;
  addToCart: (product: LocalProduct) => void;
  addManualItem: (name: string, unitPrice: number) => void;
  adjustCartLineQuantity: (lineId: string, delta: number) => void;
  setCartLineQuantity: (lineId: string, quantity: number) => void;
  removeCartLine: (lineId: string) => void;
  updatePayment: (index: number, updates: Partial<PaymentSplit>) => void;
  addPaymentSplit: (amount: number) => void;
  removePaymentSplit: (index: number) => void;
  autoBalancePayments: (finalTotal: number) => void;
  holdCurrentTransaction: () => boolean;
  resumeHeldTransaction: (id: string) => void;
  discardHeldTransaction: (id: string) => void;
  resetAfterCheckout: () => void;
};

const defaultPayment: PaymentSplit = { method: "CASH", amount: 0, reference: "" };

export const usePosStore = create<PosState>((set, get) => ({
  query: "",
  status: "",
  found: null,
  cart: [],
  paymentSplits: [defaultPayment],
  customerQuery: "",
  customerResults: [],
  selectedCustomer: null,
  redeemPoints: 0,
  heldTransactions: [],
  saving: false,
  lastSale: null,
  setQuery: (query) => set({ query }),
  setStatus: (status) => set({ status }),
  setFound: (found) => set({ found }),
  setPaymentSplits: (paymentSplits) => set({ paymentSplits }),
  setCustomerQuery: (customerQuery) => set({ customerQuery }),
  setCustomerResults: (customerResults) => set({ customerResults }),
  setSelectedCustomer: (selectedCustomer) => set({ selectedCustomer }),
  setRedeemPoints: (redeemPoints) => set({ redeemPoints }),
  setHeldTransactions: (heldTransactions) => set({ heldTransactions }),
  setSaving: (saving) => set({ saving }),
  setLastSale: (lastSale) => set({ lastSale }),
  addToCart: (product) =>
    set((state) => {
      const index = state.cart.findIndex((line) => line.id === product.id);
      if (index === -1) {
        return {
          cart: [...state.cart, { id: product.id, name: product.name, quantity: 1, unitPrice: product.sellPrice }],
        };
      }
      return {
        cart: state.cart.map((line, i) => (i === index ? { ...line, quantity: line.quantity + 1 } : line)),
      };
    }),
  addManualItem: (name, unitPrice) =>
    set((state) => ({
      cart: [...state.cart, { id: `manual-${Date.now()}`, name, quantity: 1, unitPrice }],
    })),
  adjustCartLineQuantity: (lineId, delta) =>
    set((state) => ({
      cart: state.cart
        .map((line) =>
          line.id === lineId ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line,
        )
        .filter((line) => line.quantity > 0),
    })),
  setCartLineQuantity: (lineId, quantity) =>
    set((state) => ({
      cart: state.cart
        .map((line) => (line.id === lineId ? { ...line, quantity: Math.max(0, quantity) } : line))
        .filter((line) => line.quantity > 0),
    })),
  removeCartLine: (lineId) =>
    set((state) => ({
      cart: state.cart.filter((line) => line.id !== lineId),
    })),
  updatePayment: (index, updates) =>
    set((state) => ({
      paymentSplits: state.paymentSplits.map((split, i) => (i === index ? { ...split, ...updates } : split)),
    })),
  addPaymentSplit: (amount) =>
    set((state) => ({
      paymentSplits: [...state.paymentSplits, { method: "CARD", amount: Math.max(amount, 0), reference: "" }],
    })),
  removePaymentSplit: (index) =>
    set((state) => ({
      paymentSplits:
        state.paymentSplits.length === 1 ? state.paymentSplits : state.paymentSplits.filter((_, i) => i !== index),
    })),
  autoBalancePayments: (finalTotal) =>
    set((state) => {
      if (state.paymentSplits.length === 0) return state;
      const current = state.paymentSplits.reduce((sum, p) => sum + p.amount, 0);
      const diff = Number((finalTotal - current).toFixed(2));
      if (Math.abs(diff) < 0.01) return state;
      const lastIndex = state.paymentSplits.length - 1;
      return {
        paymentSplits: state.paymentSplits.map((payment, index) =>
          index === lastIndex ? { ...payment, amount: Number(Math.max(payment.amount + diff, 0).toFixed(2)) } : payment,
        ),
      };
    }),
  holdCurrentTransaction: () => {
    const state = get();
    if (state.cart.length === 0) return false;
    const held: HeldTransaction = {
      id: `held-${Date.now()}`,
      heldAt: new Date().toISOString(),
      query: state.query,
      cart: state.cart,
      paymentSplits: state.paymentSplits,
      selectedCustomer: state.selectedCustomer,
      redeemPoints: state.redeemPoints,
    };
    set({
      heldTransactions: [held, ...state.heldTransactions],
      cart: [],
      found: null,
      query: "",
      paymentSplits: [defaultPayment],
      selectedCustomer: null,
      customerQuery: "",
      customerResults: [],
      redeemPoints: 0,
      status: "Transaction held successfully.",
    });
    return true;
  },
  resumeHeldTransaction: (id) =>
    set((state) => {
      const held = state.heldTransactions.find((item) => item.id === id);
      if (!held) return state;
      return {
        cart: held.cart,
        query: held.query,
        paymentSplits: held.paymentSplits.length > 0 ? held.paymentSplits : [defaultPayment],
        selectedCustomer: held.selectedCustomer,
        redeemPoints: held.redeemPoints,
        heldTransactions: state.heldTransactions.filter((item) => item.id !== id),
        status: "Held transaction resumed.",
      };
    }),
  discardHeldTransaction: (id) =>
    set((state) => ({
      heldTransactions: state.heldTransactions.filter((item) => item.id !== id),
      status: "Held transaction discarded.",
    })),
  resetAfterCheckout: () =>
    set({
      cart: [],
      found: null,
      query: "",
      paymentSplits: [defaultPayment],
      selectedCustomer: null,
      customerQuery: "",
      customerResults: [],
      redeemPoints: 0,
    }),
}));
