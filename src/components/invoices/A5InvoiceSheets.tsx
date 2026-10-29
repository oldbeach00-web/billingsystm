import { formatDate } from "@/lib/utils";
import { amountInWords } from "@/lib/billing";
import type { Customer, Invoice, InvoiceItem, Product } from "@/types/database";
import type { ShopDetails } from "@/components/invoices/A4InvoicePrint";

type PrintItem = InvoiceItem & { product?: Product };

interface A5InvoiceSheetsProps {
  invoice: Invoice & { customer?: Customer };
  shopDetails: ShopDetails;
  pages: PrintItem[][];
  itemsPerPage: number;
  lineDiscount: (item: PrintItem) => number;
}

// Plain amounts like the shop's printed estimates ("425.00"), no ₹ sign, so
// all seven columns stay readable at A5 width
const amt = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const qty = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });

// Sized in mm so the on-screen preview and the printed A5 sheet match. The
// <style> sits inside the printed markup, so the print window gets it too.
const A5_CSS = `
.a5-sheets { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.a5-page { width: 148mm; height: 209.5mm; padding: 7mm 7mm 6mm; background: #fff; color: #111;
  font-family: Arial, 'Helvetica Neue', sans-serif; font-size: 8.5pt; line-height: 1.25;
  display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,.15); }
.a5-head { display: flex; justify-content: space-between; gap: 4mm; }
.a5-shop-name { font-size: 12pt; font-weight: 700; text-transform: uppercase; }
.a5-muted { color: #444; font-size: 7.5pt; }
.a5-title { font-size: 12pt; font-weight: 700; text-decoration: underline; text-align: right; }
.a5-meta { margin-top: 1mm; text-align: right; }
.a5-meta td { padding: 0.3mm 0 0.3mm 2mm; }
.a5-meta td:first-child { color: #444; text-align: right; }
.a5-to { margin-top: 3mm; padding-bottom: 1.5mm; border-bottom: 0.3mm solid #111; }
.a5-to-name { font-weight: 700; text-transform: uppercase; }
.a5-tag { margin-top: 1mm; font-size: 8pt; font-weight: 700; color: #b91c1c; text-transform: uppercase; }
table.a5-items { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 1mm; }
table.a5-items th { font-weight: 700; padding: 1.2mm 1mm; border-bottom: 0.3mm solid #111; white-space: nowrap; }
table.a5-items td { height: 5.2mm; padding: 0 1mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.a5-r { text-align: right; }
.a5-c { text-align: center; }
.a5-spacer { flex: 1; }
.a5-cont { text-align: right; font-style: italic; color: #444; padding-top: 1mm; }
.a5-totals { border-top: 0.3mm solid #111; padding-top: 1mm; }
.a5-totals table { margin-left: auto; border-collapse: collapse; }
.a5-totals td { padding: 0.4mm 0 0.4mm 4mm; text-align: right; }
.a5-bill td { font-size: 11pt; font-weight: 700; padding-top: 1.5mm; border-top: 0.3mm solid #111; }
.a5-words { margin-top: 1.5mm; font-size: 7.5pt; }
.a5-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 2mm; font-size: 7.5pt; }
.a5-note { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.a5-sign { text-align: center; min-width: 38mm; }
.a5-sign-line { border-top: 0.3mm solid #444; margin-top: 7mm; padding-top: 0.5mm; }
.a5-page-no { text-align: center; color: #666; font-size: 7pt; margin-top: 1mm; }
@media print {
  .a5-sheets { display: block; }
  .a5-page { box-shadow: none; break-after: page; page-break-after: always; }
  .a5-page:last-child { break-after: auto; page-break-after: auto; }
}
`;

export function A5InvoiceSheets({
  invoice,
  shopDetails,
  pages,
  itemsPerPage,
  lineDiscount,
}: A5InvoiceSheetsProps) {
  const status = invoice.status || "due";
  const isDraft = status === "draft";
  const isCancelled = status === "cancelled";

  const totalAmt = Number(invoice.total_amount || 0);
  const paidAmt = Number(invoice.amount_paid || 0);
  const balanceAmt = isCancelled
    ? 0
    : Number(invoice.amount_due ?? Math.max(0, totalAmt - paidAmt));
  const discountAmt = Number(invoice.discount_amount || 0);
  // Only set on invoices issued while GST was charged
  const legacyTax = Number(invoice.tax_amount || 0);

  return (
    <div className="a5-sheets">
      <style>{A5_CSS}</style>

      {pages.map((pageItems, pageIdx) => {
        const isLastPage = pageIdx === pages.length - 1;
        const firstSlNo = pageIdx * itemsPerPage + 1;

        return (
          <div key={pageIdx} className="a5-page">
            <div className="a5-head">
              <div>
                <div className="a5-shop-name">{shopDetails.name}</div>
                {shopDetails.address && (
                  <div className="a5-muted">{shopDetails.address}</div>
                )}
                {shopDetails.phone && (
                  <div className="a5-muted">Phone: {shopDetails.phone}</div>
                )}
              </div>

              <div>
                <div className="a5-title">{isDraft ? "DRAFT" : "INVOICE"}</div>
                <table className="a5-meta">
                  <tbody>
                    <tr>
                      <td>No :</td>
                      <td>{invoice.invoice_number}</td>
                    </tr>
                    <tr>
                      <td>Date :</td>
                      <td>{formatDate(invoice.issue_date)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="a5-to">
              <div>
                To : <span className="a5-to-name">{invoice.customer?.name || "Cash"}</span>
              </div>
              <div className="a5-muted">
                Phone : {invoice.customer?.phone || ""}
              </div>
              {(isDraft || isCancelled) && (
                <div className="a5-tag">
                  {isDraft ? "Draft, not a valid invoice" : "Cancelled"}
                </div>
              )}
            </div>

            <table className="a5-items">
              <colgroup>
                <col style={{ width: "7mm" }} />
                <col />
                <col style={{ width: "13mm" }} />
                <col style={{ width: "10mm" }} />
                <col style={{ width: "17mm" }} />
                <col style={{ width: "15mm" }} />
                <col style={{ width: "19mm" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="a5-c">SL</th>
                  <th style={{ textAlign: "left" }}>Item</th>
                  <th className="a5-r">Qty</th>
                  <th style={{ textAlign: "left" }}>Unit</th>
                  <th className="a5-r">Rate</th>
                  <th className="a5-r">Discount</th>
                  <th className="a5-r">Total</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item, idx) => {
                  const discount = lineDiscount(item);

                  return (
                    <tr key={item.id || idx}>
                      <td className="a5-c">{firstSlNo + idx}</td>
                      <td title={item.description}>{item.description}</td>
                      <td className="a5-r">{qty(item.quantity)}</td>
                      <td>{(item.product?.unit_of_measure || "").toUpperCase()}</td>
                      <td className="a5-r">{amt(item.unit_price)}</td>
                      <td className="a5-r">{discount > 0 ? amt(discount) : ""}</td>
                      <td className="a5-r">{amt(item.total_amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="a5-spacer" />

            {!isLastPage ? (
              <div className="a5-cont">Continued on next page…</div>
            ) : (
              <>
                <div className="a5-totals">
                  <table>
                    <tbody>
                      <tr>
                        <td>Subtotal :</td>
                        <td>{amt(invoice.subtotal)}</td>
                      </tr>
                      {discountAmt > 0 && (
                        <tr>
                          <td>Discount :</td>
                          <td>- {amt(discountAmt)}</td>
                        </tr>
                      )}
                      {legacyTax > 0 && (
                        <tr>
                          <td>Tax (as billed) :</td>
                          <td>{amt(legacyTax)}</td>
                        </tr>
                      )}
                      <tr className="a5-bill">
                        <td>Bill Amount :</td>
                        <td>{amt(totalAmt)}</td>
                      </tr>
                      {(paidAmt > 0 || balanceAmt > 0) && (
                        <tr>
                          <td>Paid : {amt(paidAmt)}</td>
                          <td>Balance : {amt(balanceAmt)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="a5-words">
                  <b>In words:</b> {amountInWords(totalAmt)}
                </div>

                <div className="a5-foot">
                  <div>
                    {invoice.notes && <div className="a5-note">Note: {invoice.notes}</div>}
                    {shopDetails.footer && <div>{shopDetails.footer}</div>}
                  </div>
                  <div className="a5-sign">
                    <div className="a5-sign-line">
                      For {shopDetails.name || "the supplier"}
                    </div>
                  </div>
                </div>
              </>
            )}

            {pages.length > 1 && (
              <div className="a5-page-no">
                Page {pageIdx + 1} of {pages.length}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
