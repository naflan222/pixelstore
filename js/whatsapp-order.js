/* ============================================================
   PixelHouse - "Order on WhatsApp" button
   ------------------------------------------------------------
   HOW TO ENABLE the product name in the WhatsApp message:

   1. Set WHATSAPP_NUMBER below to your WhatsApp number in
      international format (country code + number, NO "+", no
      spaces or dashes). Example for Sri Lanka: "94771234567"

   2. That's it! Every product page button will then open your
      WhatsApp chat with the message pre-filled, e.g.:
      "I'd like to order: 50 in 1 Accesories Kit GoPro"

   If WHATSAPP_NUMBER is left empty, the button falls back to
   the WHATSAPP_FALLBACK_LINK (this opens your WhatsApp chat,
   but WhatsApp cannot pre-fill the product name for that link
   type - the message of wa.me/message/ links is fixed inside
   the WhatsApp Business app settings).
   ============================================================ */

var WHATSAPP_NUMBER = "94777466675"; // PixelHouse WhatsApp (international format, no +)

var WHATSAPP_FALLBACK_LINK = "https://wa.me/message/QJKGXD5URR5KF1";

/* ============================================================ */

(function () {
  "use strict";

  // Builds the message text for the product shown on this page.
  function buildOrderMessage() {
    // Product title, e.g. "50 in 1 Accesories Kit GoPro"
    var titleEl = document.querySelector(".product-title-meta-data .p-title-price h5");
    var productTitle = titleEl ? titleEl.textContent.replace(/\s+/g, " ").trim() : "";

    if (productTitle) {
      return "I'd like to order: " + productTitle;
    }
    return "Hello! I'd like to place an order.";
  }

  // Builds the final wa.me link for the current product.
  function buildWhatsAppLink() {
    if (WHATSAPP_NUMBER) {
      return (
        "https://wa.me/" +
        WHATSAPP_NUMBER +
        "?text=" +
        encodeURIComponent(buildOrderMessage())
      );
    }
    return WHATSAPP_FALLBACK_LINK;
  }

  // Point the button at the correct link once the page is ready.
  function initWhatsAppOrderButton() {
    var buttons = document.querySelectorAll(".btn-whatsapp");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("href", buildWhatsAppLink());
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWhatsAppOrderButton);
  } else {
    initWhatsAppOrderButton();
  }
})();
