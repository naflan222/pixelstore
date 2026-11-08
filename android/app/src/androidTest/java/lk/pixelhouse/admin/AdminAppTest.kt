package lk.pixelhouse.admin

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class AdminAppTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var app: PixelHouseApp
    private val writes = CopyOnWriteArrayList<String>()
    private val adminBodies = CopyOnWriteArrayList<org.json.JSONObject>()
    private var scenario: ActivityScenario<MainActivity>? = null
    private var role = "owner"
    @Before fun setup() {
        app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as PixelHouseApp
        val vault = SessionVault(app); vault.clear()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            if (request.method != "GET") writes.add(request.url.encodedPath)
            val path = request.url.encodedPath
            if (request.method != "GET" && path.startsWith("/api/admin/")) { val buffer = okio.Buffer(); request.body?.writeTo(buffer); adminBodies.add(org.json.JSONObject(buffer.readUtf8().ifBlank { "{}" })) }
            val body = when {
                path == "/api/mobile/capabilities" -> """{"native_admin_version":1,"csv_dry_run":true,"push_configured":false,"settings_patch":true}"""
                path == "/api/auth/me" -> """{"user":{"id":1,"username":"test-owner","role":"$role"}}"""
                path == "/api/admin/orders/301" -> """{"order":{"id":301,"full_name":"Test customer","total":1450,"status":"pending"},"payment":{"payment_status":"pending"},"items":[],"history":[]}"""
                path == "/api/admin/settings" -> """{"settings":{"store_name":"PixelHouse","currency":"LKR","shipping_fee":250,"store_open":true,"cash_enabled":true,"bank_enabled":true,"standard_delivery_enabled":true,"express_delivery_enabled":true,"order_notifications":true,"low_stock_notifications":true,"vendor_notifications":true}}"""
                path == "/api/admin/products" -> """{"products":[{"id":42,"name":"Test GoPro grip","slug":"test-grip","price":1200,"image":"","stock":5,"status":"active","featured":0,"flash_sale":0,"rating":4.5,"reorder_threshold":10}]}"""
                path == "/api/admin/homepage-sections" -> """{"sections":{"featured_gear":[]},"products":[]}"""
                path.endsWith("stats") -> """{"orders":2,"revenue":2900}"""
                else -> """{"ok":true,"orders":[],"products":[],"categories":[],"users":[],"customers":[],"coupons":[],"banners":[],"messages":[],"vendors":[],"reviews":[],"notifications":[],"logs":[]}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .apply { if (path == "/api/auth/login") addHeader("Set-Cookie", "pixels_session=test-session; Secure; HttpOnly; Path=/") }
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        app.api = AdminApi(vault, client)
    }
    private fun launch(signedIn: Boolean = true, order: Long? = null) {
        if (signedIn) app.api.vault.save("test-session")
        val intent = Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (order != null) intent.putExtra("order_id", order)
        scenario = ActivityScenario.launch(intent)
        compose.waitForIdle()
    }
    private fun hideKeyboard() {
        scenario?.onActivity { activity ->
            val manager = activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            manager.hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
        }
        compose.waitForIdle()
    }
    @After fun cleanup() { scenario?.close(); app.api.vault.clear() }
    @Test fun nativeSectionsAreReachableWithoutWebsiteWebViews() {
        launch()
        compose.waitUntil(30000) { app.api.signedIn.value }
        for (title in listOf("Orders", "Products", "Categories", "Inventory", "Users", "Customers", "Sales analytics", "Coupons", "Promotional banners", "Homepage sections", "Messages", "Vendors", "Reviews", "Notifications", "Activity log", "Admin users", "Store settings", "Phone alerts")) {
            compose.onNodeWithText("☰").performClick()
            compose.onNodeWithTag("admin-menu").performScrollToNode(hasText(title, substring = false))
            compose.onNode(hasText(title) and hasClickAction() and hasAnyAncestor(hasTestTag("admin-menu"))).performClick()
            compose.waitForIdle()
        }
        Assert.assertTrue(writes.isEmpty())
    }
    @Test fun orderNotificationOpensAuthenticatedOrderDetails() {
        launch(order = 301)
        compose.waitUntil(30000) { app.api.signedIn.value }
        compose.waitUntil(30000) { compose.onAllNodesWithText("Order #301").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasScrollToIndexAction() and hasAnyDescendant(hasText("Order #301"))).performScrollToNode(hasText("Update order status"))
        compose.onNodeWithText("Update order status").assertExists()
        Assert.assertTrue(writes.isEmpty())
    }
    @Test fun editingProductRetainsItsCustomerReviewRating() {
        launch()
        compose.waitUntil(30000) { app.api.signedIn.value }
        compose.onNodeWithText("☰").performClick()
        compose.onNodeWithTag("admin-menu").performScrollToNode(hasText("Products", substring = false))
        compose.onNode(hasText("Products") and hasClickAction() and hasAnyAncestor(hasTestTag("admin-menu"))).performClick()
        compose.waitUntil(30000) { compose.onAllNodesWithText("Edit").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Edit").performScrollTo().performClick()
        compose.waitUntil(30000) { compose.onAllNodesWithTag("field-name").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("field-name").performTextReplacement("Updated grip")
        hideKeyboard()
        compose.onNodeWithText("Save", substring = false).performClick()
        compose.waitUntil(30000) { adminBodies.isNotEmpty() }
        Assert.assertEquals(4.5, adminBodies.last().getDouble("rating"), 0.001)
        Assert.assertEquals(1200.0, adminBodies.last().getDouble("price"), 0.001)
        Assert.assertEquals(10, adminBodies.last().getInt("reorder_threshold"))
    }
    private fun openSection(title: String) {
        compose.onNodeWithText("☰").performClick()
        compose.onNodeWithTag("admin-menu").performScrollToNode(hasText(title, substring = false))
        compose.onNode(hasText(title) and hasClickAction() and hasAnyAncestor(hasTestTag("admin-menu"))).performClick()
        compose.waitForIdle()
    }
    @Test fun settingsSendsOnlyChangedFieldsAndWarnsBeforeLeaving() {
        launch()
        compose.waitUntil(30000) { app.api.signedIn.value }
        openSection("Store settings")
        compose.waitUntil(30000) { compose.onAllNodesWithTag("field-store_name").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("field-store_name").performTextReplacement("PixelHouse updated")
        hideKeyboard()
        openSection("Orders")
        compose.onNodeWithText("Discard unsaved settings?").assertExists()
        compose.onNodeWithText("Keep editing").performClick()
        compose.onNodeWithText("Save changes").performClick()
        compose.waitUntil(30000) { adminBodies.isNotEmpty() }
        Assert.assertEquals(1, adminBodies.last().length())
        Assert.assertEquals("PixelHouse updated", adminBodies.last().getString("store_name"))
    }
    @Test fun dashboardAndAnalyticsUseReadableSalesLabels() {
        launch()
        compose.waitUntil(30000) { app.api.signedIn.value }
        compose.onNodeWithText("Your store at a glance").assertExists()
        compose.onNodeWithText("View pending orders").performScrollTo().performClick()
        compose.onNodeWithText("Search orders").assertExists()
        openSection("Sales analytics")
        compose.onNodeWithText("Order sales").assertExists()
        compose.onNodeWithText("Custom dates").assertExists()
    }
    @Test fun nonOwnerCannotSignIn() {
        role = "customer"; launch(signedIn = false)
        compose.onNodeWithText("Username or email").performTextInput("customer")
        compose.onNodeWithText("Password").performTextInput("not-a-real-password")
        hideKeyboard()
        compose.onNodeWithText("Sign in", substring = false).performScrollTo().performClick()
        try {
            compose.waitUntil(60000) { compose.onAllNodesWithText("This app is available only to your PixelHouse owner account.").fetchSemanticsNodes().isNotEmpty() }
        } catch (failure: Throwable) {
            scenario?.onActivity { activity -> val vm = androidx.lifecycle.ViewModelProvider(activity)[AdminViewModel::class.java]; println("AUTH_TEST_STATE: message=${vm.message.value}; busy=${vm.loading.value}; authenticated=${vm.signedIn.value}; paths=$writes") }
            throw failure
        }
        Assert.assertFalse(app.api.signedIn.value)
        Assert.assertNull(app.api.vault.token())
    }
}
