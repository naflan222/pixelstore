package lk.pixelhouse.admin

import org.json.JSONArray
import org.json.JSONObject

enum class InputKind { Text, Number, Boolean, Password, Multiline }
data class Field(val key: String, val label: String = label(key), val kind: InputKind = InputKind.Text, val choices: List<String> = emptyList(), val required: Boolean = false, val default: String = "")
data class Module(val title: String, val endpoint: String, val array: String = "", val fields: List<Field> = emptyList(), val create: Boolean = false, val delete: Boolean = false, val filters: List<Field> = emptyList())
fun label(key: String) = key.replace('_', ' ').replaceFirstChar { it.uppercase() }
fun text(key: String, required: Boolean = false, default: String = "") = Field(key, required = required, default = default)
fun number(key: String, default: String = "") = Field(key, kind = InputKind.Number, default = default)
fun flag(key: String, default: String = "true") = Field(key, kind = InputKind.Boolean, default = default)
fun choice(key: String, vararg choices: String) = Field(key, choices = choices.toList(), default = choices.firstOrNull() ?: "")
val roles = arrayOf("owner", "admin", "order_manager", "catalog_manager", "support")
val orderStates = arrayOf("pending", "processing", "packed", "shipped", "delivered", "cancelled", "refunded")
val productFields = listOf(text("name", true), text("slug", true), Field("price", kind = InputKind.Number, required = true, default = "0"), number("old_price"), text("image", default = "img/product/1.webp"), Field("description", kind = InputKind.Multiline), number("category_id"), text("sku"), text("brand"), text("mpn"), text("gtin"), text("badge"), number("stock", "0"), number("reorder_threshold", "10"), choice("status", "active", "inactive", "draft"), flag("featured", "false"), flag("flash_sale", "false"))
val categoryFields = listOf(text("name", true), text("slug", true), Field("description", kind = InputKind.Multiline), text("image"), flag("is_active"))
val adminFields = listOf(text("username", true), text("email", true), text("full_name"), text("phone"), choice("role", "admin", "order_manager", "catalog_manager", "support", "owner"), flag("is_active"), Field("password", "Password (required for a new account)", InputKind.Password))
val couponFields = listOf(text("code", true), choice("discount_type", "percentage", "fixed"), number("discount_value", "0"), number("minimum_order_amount", "0"), number("maximum_discount"), number("usage_limit"), text("expires_at"), flag("is_active"))
val bannerFields = listOf(text("title", true), text("image", true), Field("description", kind = InputKind.Multiline), text("button_text"), text("button_url"), number("display_order", "0"), text("starts_at"), text("ends_at"), flag("is_active"))
val settingsFields = listOf(text("store_name", true), text("currency", true), text("store_email"), text("store_phone"), flag("store_open"), flag("cash_enabled"), flag("bank_enabled"), number("shipping_fee", "0"), flag("standard_delivery_enabled"), flag("express_delivery_enabled"), flag("order_notifications"), flag("low_stock_notifications"), flag("vendor_notifications"))
val modules = listOf(
    Module("Dashboard", "stats"),
    Module("Orders", "orders", "orders", filters = listOf(choice("status", "all", *orderStates), choice("payment_method", "all", "cash", "bank"), choice("payment_status", "all", "pending", "paid", "failed", "refunded"), text("date"))),
    Module("Invoice generator", "invoices/catalog", "products"),
    Module("Products", "products", "products", productFields, true, true, listOf(text("category"))),
    Module("Categories", "categories", "categories", categoryFields, true, true),
    Module("Inventory", "inventory", "products"),
    Module("Users", "users", "users"),
    Module("Customers", "customers", "customers"),
    Module("Sales analytics", "analytics", filters = listOf(choice("range", "last_30_days", "last_7_days", "today", "this_month", "last_month", "this_year", "custom"), text("start"), text("end"))),
    Module("Coupons", "coupons", "coupons", couponFields, true, true),
    Module("Promotional banners", "promotional-banners", "banners", bannerFields, true, true),
    Module("Homepage sections", "homepage-sections"),
    Module("Messages", "messages", "messages"),
    Module("Vendors", "vendors", "vendors"),
    Module("Reviews", "reviews", "reviews", delete = true),
    Module("Notifications", "notifications", "notifications", filters = listOf(choice("read", "all", "false", "true"))),
    Module("Activity log", "audit-logs", "logs", filters = listOf(Field("admin", "Admin account ID", InputKind.Number), text("action"), text("entity_type"), text("start_date"), text("end_date"))),
    Module("Admin users", "admin-users", "users", adminFields, true),
    Module("Store settings", "settings", fields = settingsFields),
    Module("Phone alerts", "@phone")
)
fun JSONObject.display(key: String): String = if (!has(key) || isNull(key)) "" else opt(key)?.toString().orEmpty()
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONObject.title(): String = listOf("name", "title", "full_name", "username", "code", "product_name", "action").firstNotNullOfOrNull { display(it).takeIf(String::isNotBlank) } ?: "Order #${display("id") }"
fun formBody(fields: List<Field>, values: Map<String, String>): JSONObject {
    val body = JSONObject()
    fields.forEach { f ->
        val v = values[f.key].orEmpty().trim()
        require(!f.required || v.isNotBlank()) { "${f.label} is required." }
        when (f.kind) {
            InputKind.Boolean -> body.put(f.key, v == "true")
            InputKind.Number -> {
                if (v.isBlank()) body.put(f.key, JSONObject.NULL)
                else { val n = v.toDoubleOrNull(); require(n != null && n.isFinite()) { "Enter a valid ${f.label.lowercase()}." }; body.put(f.key, n) }
            }
            else -> if (f.kind != InputKind.Password || v.isNotEmpty()) body.put(f.key, v)
        }
    }
    return body
}

fun productEditBody(body: JSONObject, initial: JSONObject): JSONObject = body.put("rating", initial.optDouble("rating", 0.0))
