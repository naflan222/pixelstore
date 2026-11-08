package lk.pixelhouse.admin

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AdminModelsTest {
    @Test fun `settings values retain booleans and numeric money`() {
        val body = formBody(listOf(flag("store_open"), number("shipping_fee")), mapOf("store_open" to "false", "shipping_fee" to "250.50"))
        assertEquals(false, body.getBoolean("store_open"))
        assertEquals(250.5, body.getDouble("shipping_fee"), 0.001)
    }
    @Test fun `blank passwords are omitted on account edits`() {
        val body = formBody(adminFields, mapOf("username" to "owner", "email" to "owner@example.test", "password" to "", "is_active" to "true"))
        assertFalse(body.has("password"))
        assertTrue(body.getBoolean("is_active"))
    }
    @Test fun `required names and non-finite numeric values are rejected`() {
        assertThrows(IllegalArgumentException::class.java) { formBody(listOf(text("name", true)), emptyMap()) }
        for (invalid in listOf("Infinity", "NaN", "garbage")) assertThrows(IllegalArgumentException::class.java) { formBody(listOf(number("price")), mapOf("price" to invalid)) }
    }
    @Test fun `optional numeric fields remain null instead of becoming zero`() {
        val body = formBody(listOf(number("old_price")), mapOf("old_price" to ""))
        assertEquals(JSONObject.NULL, body.get("old_price"))
    }
    @Test fun `all existing admin sections are available as native modules`() {
        assertTrue(modules.map { it.endpoint }.containsAll(listOf("orders", "products", "categories", "inventory", "users", "customers", "analytics", "coupons", "promotional-banners", "homepage-sections", "messages", "vendors", "reviews", "notifications", "audit-logs", "admin-users", "settings", "invoices/catalog")))
        assertEquals(modules.size, modules.map { it.endpoint }.distinct().size)
    }
    @Test fun `editing product details preserves the existing review aggregate`() {
        val updated = productEditBody(JSONObject().put("price", 1500), JSONObject().put("rating", 4.5))
        assertEquals(4.5, updated.getDouble("rating"), 0.001)
        assertEquals(1500, updated.getInt("price"))
        assertTrue(productFields.any { it.key == "price" && it.required })
        assertTrue(productFields.any { it.key == "reorder_threshold" })
    }
    @Test fun `bounded imports reject oversize content`() {
        assertArrayEquals("abc".toByteArray(), readLimited("abc".byteInputStream(), 3))
        assertThrows(IllegalArgumentException::class.java) { readLimited("abcd".byteInputStream(), 3) }
    }
}
