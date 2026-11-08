@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package lk.pixelhouse.admin

import android.app.DatePickerDialog
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

@Composable fun InfoCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Text(title, style = MaterialTheme.typography.titleMedium); content() } }
}
@Composable fun Metric(title: String, value: String) { Column { Text(title, style = MaterialTheme.typography.labelLarge); Text(value, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary) } }
@Composable fun Badges(vararg values: String) { FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { values.filter(String::isNotBlank).forEach { Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) { Text(statusTitle(it), Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelLarge) } } } }
@Composable fun OrderPreview(vm: AdminViewModel, row: JSONObject, currency: String) {
    val order = OrderCardData.parse(row)
    OutlinedCard(onClick = { vm.openOrder(order.id) }, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("#${order.id} · ${order.customer}", style = MaterialTheme.typography.titleMedium)
        Text(displayMoney(order.total, currency), style = MaterialTheme.typography.titleLarge)
        Badges(order.status, order.payment)
        Text("${displayTime(order.date)} · ${order.items} item(s)", style = MaterialTheme.typography.bodySmall)
        Text("View order →", color = MaterialTheme.colorScheme.primary)
    } }
}
@Composable fun DashboardScreen(vm: AdminViewModel, data: JSONObject) {
    val currency by vm.currency.collectAsStateWithLifecycle()
    val summary = data.optJSONObject("analytics")?.optJSONObject("summary") ?: JSONObject()
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text("Your store at a glance", style = MaterialTheme.typography.headlineSmall); Text("Sri Lanka time · Order value, including unpaid orders") }
        item { InfoCard("Sales") { Metric("Today", displayMoney(summary.number("today_revenue"), currency)); HorizontalDivider(); Metric("This month", displayMoney(summary.number("this_month_revenue"), currency)); Text("Cancelled and refunded orders excluded.", style = MaterialTheme.typography.bodySmall) } }
        item { InfoCard("Needs attention") { Metric("Pending orders", data.display("pending_orders").ifBlank { "0" }); Button(onClick = { vm.filterOrders("pending") }, modifier = Modifier.fillMaxWidth()) { Text("View pending orders") }; Text("${data.optInt("low_stock")} products with stock below 10 · ${data.optInt("out_of_stock")} out of stock") } }
        item { Text("Recent orders", style = MaterialTheme.typography.titleLarge) }
        items(data.optJSONArray("recentOrders")?.objects().orEmpty()) { OrderPreview(vm, it, currency) }
        if (data.optJSONArray("recentOrders")?.length() == 0) item { Text("No orders yet.") }
        item { InfoCard("Stock below 10") { data.optJSONArray("lowStock")?.objects().orEmpty().forEach { Text("${it.display("name")} · ${it.optInt("stock")} remaining") }; if(data.optJSONArray("lowStock")?.length() == 0) Text("No stock alerts.") } }
    }
}
@Composable fun DateChoice(title: String, value: String, changed: (String) -> Unit) {
    val context = LocalContext.current
    OutlinedButton(onClick = { val d = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now()); DatePickerDialog(context, { _, y, m, day -> changed(LocalDate.of(y, m + 1, day).toString()) }, d.year, d.monthValue - 1, d.dayOfMonth).show() }) { Text("$title: ${value.ifBlank { "Any date" }}") }
}
@Composable fun OrdersScreen(vm: AdminViewModel, data: JSONObject, busy: Boolean) {
    val currency by vm.currency.collectAsStateWithLifecycle()
    var search by rememberSaveable { mutableStateOf(vm.query) }
    var filter by remember { mutableStateOf(false) }
    val listState = rememberLazyListState(vm.orderListIndex, vm.orderListOffset)
    DisposableEffect(listState) { onDispose { vm.orderListIndex = listState.firstVisibleItemIndex; vm.orderListOffset = listState.firstVisibleItemScrollOffset } }
    LazyColumn(state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { OutlinedTextField(search, { search = it }, label = { Text("Name, phone, email or order number") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Row { Button(enabled = !busy, onClick = { vm.applyFilters(search) }) { Text("Search orders") }; TextButton(onClick = { filter = true }) { Text("Filters") } }
            Text(vm.filters.filterValues { it.isNotBlank() && it != "all" }.entries.joinToString(" · ") { "${label(it.key)}: ${statusTitle(it.value)}" }.ifBlank { "All orders" })
            DateChoice("Order date", vm.filters["date"].orEmpty()) { vm.applyFilters(search, vm.filters + ("date" to it)) }; TextButton(onClick = { search = ""; vm.applyFilters("", emptyMap()) }) { Text("Clear filters") }
            Text("${data.optInt("total")} matching orders · Sri Lanka time", style = MaterialTheme.typography.bodySmall)
        }
        items(data.optJSONArray("orders")?.objects().orEmpty(), key = { it.optLong("id") }) { OrderPreview(vm, it, currency) }
        if (!busy && data.optJSONArray("orders")?.length() == 0) item { Text("No matching orders. Try another search or clear your filters.") }
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { TextButton(enabled = vm.currentPage > 1 && !busy, onClick = { vm.currentPage--; vm.load() }) { Text("Previous") }; Text("Page ${vm.currentPage}"); TextButton(enabled = vm.currentPage < data.optInt("pages") && !busy, onClick = { vm.currentPage++; vm.load() }) { Text("Next") } } }
    }
    if (filter) Editor(EditRequest("Filter orders", "@filters", "GET", modules.first { it.endpoint == "orders" }.filters.filter { it.key != "date" }, JSONObject(vm.filters)), { filter = false }) { body -> vm.applyFilters(search, body.keys().asSequence().associateWith { body.display(it) } + ("date" to vm.filters["date"].orEmpty())); filter = false }

}
@Composable fun OrderDetailsScreen(vm: AdminViewModel, data: JSONObject) {
    val order = data.optJSONObject("order") ?: return
    val payment = data.optJSONObject("payment") ?: JSONObject()
    val currency by vm.currency.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val id = order.optLong("id")
    var edit by remember(id) { mutableStateOf<EditRequest?>(null) }
    var more by remember { mutableStateOf(false) }
    var delete by remember { mutableStateOf(false) }
    fun back() { vm.detail.value = null }
    BackHandler { back() }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { TextButton(onClick = { back() }) { Text("← Back to orders") }; Text("Order #$id", style = MaterialTheme.typography.headlineMedium); Text(displayTime(order.display("created_at"))); Badges(order.display("status"), payment.display("payment_status")) }
        item { InfoCard("Customer") { Text(order.display("full_name"), style = MaterialTheme.typography.titleLarge); Text(order.display("address").ifBlank { "No delivery address" }); listOf("phone" to "tel:", "email" to "mailto:").forEach { (key, scheme) -> val value = order.display(key); if(value.isNotBlank()) TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(scheme + Uri.encode(value)))) }.onFailure { vm.message.value = "No app is available to open this contact." } }) { Text(value) } } } }
        item { InfoCard("Items") { data.optJSONArray("items")?.objects().orEmpty().forEach { item -> Text(item.display("name"), style = MaterialTheme.typography.titleSmall); Text("${item.optInt("quantity")} × ${displayMoney(item.number("price"), currency)} = ${displayMoney(item.optInt("quantity") * item.number("price"), currency)}"); HorizontalDivider() } } }
        item { InfoCard("Order totals") { listOf("subtotal" to "Items", "shipping_fee" to "Delivery", "discount_amount" to "Discount", "total" to "Total order value").forEach { (key,title) -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(title); Text(displayMoney(order.number(key), currency)) } }; Text("Payment: ${statusTitle(payment.display("payment_method"))} · ${statusTitle(payment.display("payment_status"))}"); Text("Amount recorded as paid: ${displayMoney(payment.number("amount_paid"), currency)}"); payment.display("transaction_id").takeIf(String::isNotBlank)?.let { Text("Transaction: $it") }; payment.display("paid_at").takeIf(String::isNotBlank)?.let { Text("Paid: ${displayTime(it)}") }; order.display("coupon_code").takeIf(String::isNotBlank)?.let { Text("Coupon: $it") } } }
        item { InfoCard("Delivery & notes") { listOf("shipping_method", "shipping_status", "carrier", "tracking_number", "shipping_notes", "internal_notes").forEach { key -> order.display(key).takeIf(String::isNotBlank)?.let { Text("${label(key)}: $it") } }; OutlinedButton(onClick = { edit = EditRequest("Delivery and internal notes", "/api/admin/orders/$id/fulfillment", "PUT", listOf(text("carrier"), text("tracking_number"), choice("shipping_status", "pending", "preparing", "shipped", "delivered", "returned"), Field("shipping_notes", kind = InputKind.Multiline), Field("internal_notes", kind = InputKind.Multiline)), order) }) { Text("Update delivery") } } }
        item { Button(onClick = { edit = EditRequest("Update order status", "/api/admin/orders/$id/status", "PUT", listOf(choice("status", *orderStates), Field("note", kind = InputKind.Multiline)), order) }, modifier = Modifier.fillMaxWidth()) { Text("Update order status") }; OutlinedButton(onClick = { vm.work { shareDocument(context, vm.api.download("/api/admin/orders/$id/invoice"), "invoice-$id.pdf", "application/pdf") } }, modifier = Modifier.fillMaxWidth()) { Text("Download / share invoice") } }
        item { InfoCard("Status history") { val history = data.optJSONArray("history")?.objects().orEmpty(); if(history.isEmpty()) Text("No status changes yet."); history.forEach { Text("${statusTitle(it.display("status").ifBlank { it.display("to_status") })} · ${displayTime(it.display("created_at"))}"); it.display("note").takeIf(String::isNotBlank)?.let { Text(it) } } } }
        item { TextButton(onClick = { more = !more }) { Text("More actions") }; if(more) TextButton(onClick = { delete = true }) { Text("Delete order", color = MaterialTheme.colorScheme.error) } }
    }
    edit?.let { r -> Editor(r, { edit = null }) { vm.mutate(r.path, r.method, it) { edit = null } } }
    if(delete) Editor(EditRequest("Delete order #$id?", "", "DELETE", emptyList()), { delete = false }, true) { vm.mutate("/api/admin/orders/$id", "DELETE") { delete = false; back() } }
}
@Composable fun AnalyticsScreen(vm: AdminViewModel, data: JSONObject) {
    val currency by vm.currency.collectAsStateWithLifecycle()
    var start by rememberSaveable { mutableStateOf(todayInStore()) }
    var end by rememberSaveable { mutableStateOf(todayInStore()) }
    var error by remember { mutableStateOf("") }
    val summary = data.optJSONObject("summary") ?: JSONObject()
    val range = data.optJSONObject("range") ?: JSONObject()
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text("Order sales", style = MaterialTheme.typography.headlineSmall); Text("Sri Lanka time · Includes unpaid orders; excludes cancelled and refunded orders."); FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("today" to "Today", "last_7_days" to "7 days", "last_30_days" to "30 days", "this_month" to "This month", "last_month" to "Last month", "this_year" to "This year").forEach { (key,title) -> FilterChip(selected = vm.filters["range"].orEmpty().ifBlank { "last_30_days" } == key, onClick = { vm.applyFilters(values = mapOf("range" to key)) }, label = { Text(title) }) } } }
        item { InfoCard("Custom dates") { DateChoice("From", start) { start = it }; DateChoice("To", end) { end = it }; Button(onClick = { if(end < start) error = "End date must be on or after the start date." else { error = ""; vm.applyFilters(values = mapOf("range" to "custom", "start" to start, "end" to end)) } }) { Text("Apply date range") }; if(error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error) } }
        item { InfoCard("${displayDay(range.display("start"))} – ${displayDay(range.display("end"))}") { Metric("Total order value", displayMoney(summary.number("range_revenue"), currency)); Metric("Orders", summary.display("range_orders").ifBlank { "0" }); Metric("Average order value", displayMoney(summary.number("average_order_value"), currency)) } }
        item { InfoCard("Sales over time") {
            val days = runCatching { ChronoUnit.DAYS.between(LocalDate.parse(range.display("start")), LocalDate.parse(range.display("end"))) }.getOrDefault(0)
            val points = if(days > 90) salesPoints(data.optJSONArray("sales_by_month"), true) else dailyPoints(data.optJSONArray("sales_by_day"), range.display("start"), range.display("end"))
            val maximum = points.maxOfOrNull { it.sales }?.coerceAtLeast(1.0) ?: 1.0
            if(points.isEmpty()) Text("No sales in this period.")
            var selectedDay by remember(range.toString()) { mutableStateOf("") }
            val selected = points.firstOrNull { it.day == selectedDay } ?: points.lastOrNull()
            selected?.let { Text("${displayDay(it.day)} · ${displayMoney(it.sales, currency)} · ${it.orders} orders", style = MaterialTheme.typography.bodyMedium) }
            Text("Swipe the chart and tap a bar for details.", style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                points.forEach { point ->
                    Column(Modifier.width(if(days > 90) 64.dp else 48.dp).clickable { selectedDay = point.day }.semantics { contentDescription = "${point.day}: ${displayMoney(point.sales, currency)}, ${point.orders} orders" }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.BottomCenter) { Box(Modifier.width(24.dp).height((120f * (point.sales / maximum).toFloat()).coerceIn(2f, 120f).dp).background(if(selected?.day == point.day) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary, MaterialTheme.shapes.extraSmall)) }
                        Text(if(days > 90) point.day else point.day.takeLast(5), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        } }
        listOf("top_products" to "Top products", "top_categories" to "Top categories").forEach { (key,title) -> item { InfoCard(title) { val rows = data.optJSONArray(key)?.objects().orEmpty(); if(rows.isEmpty()) Text("No sales yet in this period."); rows.forEachIndexed { index,row -> Text("${index + 1}. ${row.display("name")}", style = MaterialTheme.typography.titleSmall); Text("${row.display("quantity_sold")} sold · ${displayMoney(row.number("revenue"), currency)}"); HorizontalDivider() } } } }
    }
}
@Composable fun StoreSettingsScreen(vm: AdminViewModel, data: JSONObject, busy: Boolean) {
    val original = data.optJSONObject("settings") ?: return
    val capabilities by vm.api.capabilities.collectAsStateWithLifecycle()
    val values = remember(original) { mutableStateMapOf<String,String>().apply { settingsFields.forEach { f -> put(f.key, if(f.kind == InputKind.Boolean) (original.display(f.key) in listOf("true", "1")).toString() else original.display(f.key)) } } }
    var error by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf<JSONObject?>(null) }
    val dirty = settingsFields.any { f -> values[f.key] != (if(f.kind == InputKind.Boolean) (original.display(f.key) in listOf("true", "1")).toString() else original.display(f.key)) }
    LaunchedEffect(dirty) { vm.settingsDirty.value = dirty }
    DisposableEffect(Unit) { onDispose { vm.settingsDirty.value = false } }
    fun save(body: JSONObject) { vm.mutate("/api/admin/settings", "PATCH", body) }
    Column(Modifier.fillMaxSize()) {
        if(!capabilities.optBoolean("settings_patch")) Text("Deploy the server update before editing settings. Your current settings are safe.", Modifier.padding(16.dp))
        LazyColumn(Modifier.weight(1f).imePadding(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            settingsGroups.forEach { (title,keys) -> item { InfoCard(title) { settingsFields.filter { it.key in keys }.forEach { f -> FieldInput(f.copy(label = settingTitles[f.key] ?: f.label), values[f.key].orEmpty()) { values[f.key] = it; error = "" } }; if(title == "Delivery") Text("Changing this fee affects standard delivery only. Express and pickup fees stay as configured.", style = MaterialTheme.typography.bodySmall) } } }

        }
        if(error.isNotBlank()) Text(error, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        Surface(tonalElevation = 3.dp) { Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) { TextButton(enabled = dirty && !busy, onClick = { settingsFields.forEach { f -> values[f.key] = if(f.kind == InputKind.Boolean) (original.display(f.key) in listOf("true", "1")).toString() else original.display(f.key) }; error = "" }) { Text("Cancel changes") }; Button(enabled = dirty && !busy && capabilities.optBoolean("settings_patch"), onClick = { try { require(values["currency"].orEmpty().matches(Regex("[A-Z]{3}"))) { "Enter a three-letter uppercase currency code." }; val email = values["store_email"].orEmpty(); require(email.isBlank() || android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) { "Enter a valid contact email." }; val fee = values["shipping_fee"].orEmpty().toDoubleOrNull(); require(fee != null && fee.isFinite() && fee in 0.0..1000000.0) { "Enter a delivery fee between 0 and 1,000,000." }; val body = settingsChanges(settingsFields, values, original); if(body.has("store_open") && values["store_open"] == "false" || (body.has("cash_enabled") || body.has("bank_enabled")) && values["cash_enabled"] == "false" && values["bank_enabled"] == "false") confirm = body else save(body) } catch(e: Exception) { error = e.message ?: "Check your settings." } }) { Text(if(dirty) "Save changes" else "Saved") } } }
    }
    confirm?.let { body -> AlertDialog(onDismissRequest = { confirm = null }, title = { Text("Change checkout availability?") }, text = { Text("These settings close the store or disable all supported website payment options. Customers may be unable to place orders.") }, confirmButton = { TextButton(onClick = { confirm = null; save(body) }) { Text("Confirm changes") } }, dismissButton = { TextButton(onClick = { confirm = null }) { Text("Keep editing") } }) }
}
