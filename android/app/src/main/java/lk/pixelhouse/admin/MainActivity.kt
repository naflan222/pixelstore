@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package lk.pixelhouse.admin

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class MainActivity: ComponentActivity() {
    private val order = mutableStateOf<Long?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        order.value = intent.getLongExtra("order_id", 0).takeIf { it > 0 }
        setContent { MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xFFBEB9FF)) else lightColorScheme(primary = Color(0xFF625AFA))) {
            val vm: AdminViewModel = viewModel()
            LaunchedEffect(order.value) { order.value?.let(vm::openOrder); order.value = null }
            PixelHouseAdmin(vm)
        } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); order.value = intent.getLongExtra("order_id", 0).takeIf { it > 0 } }
}

@Composable fun PixelHouseAdmin(vm: AdminViewModel) {
    val signedIn by vm.signedIn.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current
    DisposableEffect(lifecycle, signedIn) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME && signedIn) vm.work { vm.api.verify() } }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    val busy by vm.loading.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    if (!signedIn) { Login(vm, busy, message); return }
    val module by vm.module.collectAsStateWithLifecycle()
    val data by vm.data.collectAsStateWithLifecycle()
    val detail by vm.detail.collectAsStateWithLifecycle()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var confirmLogout by remember { mutableStateOf(false) }
    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet { LazyColumn(Modifier.fillMaxWidth(0.88f).testTag("admin-menu")) {
            item { Text("PixelHouse Admin", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(24.dp)) }
            items(modules) { m -> NavigationDrawerItem(label = { Text(m.title) }, selected = module == m, onClick = { vm.select(m); scope.launch { drawer.close() } }, modifier = Modifier.padding(horizontal = 12.dp)) }
            item { TextButton(onClick = { confirmLogout = true }, modifier = Modifier.padding(12.dp)) { Text("Sign out") } }
        } }
    }) {
        Scaffold(topBar = { TopAppBar(title = { Text(module.title) }, navigationIcon = { TextButton(onClick = { scope.launch { drawer.open() } }) { Text("☰") } }, actions = { TextButton(enabled = !busy, onClick = { vm.load() }) { Text("Refresh") } }) }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (message.isNotBlank()) Surface(color = MaterialTheme.colorScheme.secondaryContainer) { Text(message, Modifier.fillMaxWidth().padding(12.dp)) }
                if (module.endpoint == "@phone") PhoneAlerts(vm)
                else if (detail != null) DetailScreen(vm, detail!!)
                else ModuleScreen(vm, module, data, busy)
            }
        }
    }
    if (confirmLogout) AlertDialog(onDismissRequest = { confirmLogout = false }, title = { Text("Sign out?") }, text = { Text("Order alerts for this session will stop. An internet connection is needed to revoke the session.") }, confirmButton = { TextButton(onClick = { confirmLogout = false; vm.logout() }) { Text("Sign out") } }, dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancel") } })
}

@Composable private fun Login(vm: AdminViewModel, busy: Boolean, message: String) {
    var username by rememberSaveable { mutableStateOf("") }
    // Deliberately not saveable: never persist a password across activity recreation.
    var password by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("PixelHouse", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary)
        Text("Owner workspace", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 16.dp))
        Text("Sign in with your existing PixelHouse owner account.")
        OutlinedTextField(username, { username = it }, label = { Text("Username or email") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 20.dp))
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), singleLine = true, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
        Button(enabled = !busy && username.isNotBlank() && password.isNotBlank(), onClick = { vm.login(username.trim(), password) { password = "" } }, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Signing in…" else "Sign in") }
        if (message.isNotBlank()) Text(message, modifier = Modifier.padding(top = 16.dp), color = MaterialTheme.colorScheme.error)
    }
}

data class EditRequest(val title: String, val path: String, val method: String, val fields: List<Field>, val initial: JSONObject = JSONObject(), val transform: (JSONObject) -> JSONObject = { it }, val saved: (JSONObject) -> Unit = {})
data class DeleteRequest(val path: String, val name: String, val fields: List<Field> = emptyList())

@Composable private fun ModuleScreen(vm: AdminViewModel, module: Module, data: JSONObject, busy: Boolean) {
    var edit by remember(module) { mutableStateOf<EditRequest?>(null) }
    var deletion by remember(module) { mutableStateOf<DeleteRequest?>(null) }
    var selected by remember(module) { mutableStateOf(setOf<Long>()) }
    var inspect by remember(module) { mutableStateOf<JSONObject?>(null) }
    var images by remember(module) { mutableStateOf<Long?>(null) }
    var search by remember(module) { mutableStateOf("") }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val exportName = "products.csv"
    var pendingImport by remember(module) { mutableStateOf<String?>(null) }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri -> if (uri != null) vm.work { val bytes = vm.api.download("/api/admin/products/export"); kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("Could not write the CSV file.") }; vm.message.value = "Products exported." } }
    val import = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.work {
        val content = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { input -> val bytes = readLimited(input, 5 * 1024 * 1024); require(bytes.size <= 5 * 1024 * 1024) { "CSV must be smaller than 5 MB." }; String(bytes) } ?: error("Could not read that file.") }
        val preview = vm.api.csv("/api/admin/products/import?dry_run=true", content)
        // Preview first. A separate explicit dialog below performs the write.
        inspect = preview
        pendingImport = content
    } }
    val records = data.optJSONArray(module.array)?.objects().orEmpty()
    val visible = if (search.isBlank() || module.endpoint in listOf("orders", "users", "customers", "products")) records else records.filter { row -> listOf("name", "title", "full_name", "username", "email", "phone", "sku", "code", "body", "comment", "product_name", "action").any { row.display(it).contains(search, ignoreCase = true) } }
    LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (module.array.isNotEmpty()) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(search, { search = it }, label = { Text("Search") }, singleLine = true, modifier = Modifier.weight(1f))
                    TextButton(enabled = !busy, onClick = { vm.query = search; vm.currentPage = 1; vm.load() }) { Text("Search") }
                }
                if (module.filters.isNotEmpty()) TextButton(onClick = { edit = EditRequest("Filter ${module.title.lowercase()}", "@filters", "GET", module.filters, JSONObject(vm.filters), saved = {}) }) { Text("Filters") }
                if (module.create) Button(onClick = { edit = EditRequest("Add ${module.title.lowercase()}", "/api/admin/${module.endpoint}", "POST", if (module.endpoint == "products") module.fields.filter { it.key != "reorder_threshold" } else module.fields) }) { Text("Add new") }
                if (module.endpoint == "products") {
                    Row { TextButton(onClick = { export.launch(exportName) }) { Text("Export CSV") }; TextButton(onClick = { import.launch(arrayOf("text/*", "application/csv", "application/vnd.ms-excel")) }) { Text("Import CSV") } }
                    if (selected.isNotEmpty()) TextButton(onClick = { edit = EditRequest("Update ${selected.size} selected products", "/api/admin/products/bulk", "POST", listOf(choice("action", "status", "featured", "category", "adjust_stock", "delete"), choice("status", "active", "inactive", "draft"), flag("featured"), number("category_id"), number("change"), text("reason"), flag("confirm", "false")), transform = { it.put("ids", JSONArray(selected.toList())) }, saved = { selected = emptySet() }) }) { Text("Bulk actions (${selected.size})") }
                }
                if (module.endpoint == "notifications") TextButton(onClick = { vm.mutate("/api/admin/notifications/read", "POST") }) { Text("Mark all read") }
                if (module.endpoint == "settings" && data.has("settings")) Button(onClick = { edit = EditRequest("Store settings", "/api/admin/settings", "PUT", settingsFields, data.getJSONObject("settings")) }) { Text("Edit store settings") }
                if (module.endpoint == "invoices/catalog") Button(onClick = { inspect = JSONObject().put("@invoice", true) }) { Text("Create offline invoice") }
            }
        }
        if (module.endpoint == "homepage-sections") item { HomepageSections(vm, data) }
        if (module.array.isEmpty() && module.endpoint != "homepage-sections") item { Document(data) }
        if (module.array.isNotEmpty() && visible.isEmpty() && !busy) item { Text("No records found. Try refreshing or changing your filters.") }
        items(visible, key = { it.display("id").ifBlank { it.toString().hashCode().toString() } }) { row ->
            val id = row.optLong("id")
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (module.endpoint == "products") Row { Checkbox(selected.contains(id), { checked -> selected = if (checked) selected + id else selected - id }); Text(row.title(), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp)) }
                else Text(row.title(), style = MaterialTheme.typography.titleMedium)
                row.display("image").takeIf { it.isNotBlank() }?.let { ProductImage(it, Modifier.height(110.dp).fillMaxWidth()) }
                Summary(row)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = { when (module.endpoint) { "orders" -> vm.openOrder(id); "customers" -> vm.openCustomer(id); else -> inspect = row } }) { Text("Details") }
                    if (module.fields.isNotEmpty()) TextButton(onClick = { edit = EditRequest("Edit ${row.title()}", "/api/admin/${module.endpoint}/$id", "PUT", module.fields, row, transform = { body -> if (module.endpoint == "products") productEditBody(body, row) else body }) }) { Text("Edit") }
                    when (module.endpoint) {
                        "products" -> TextButton(onClick = { images = id }) { Text("Images") }
                        "inventory" -> TextButton(onClick = { edit = EditRequest("Adjust ${row.title()}", "/api/admin/inventory/$id/adjust", "POST", listOf(choice("mode", "adjust", "set"), number("change", "0"), text("reason", true), text("note"))) }) { Text("Adjust stock") }
                        "users" -> TextButton(onClick = { edit = EditRequest("Change role", "/api/admin/users/$id/role", "PUT", listOf(choice("role", "customer", *roles)), row) }) { Text("Change role") }
                        "vendors" -> TextButton(onClick = { edit = EditRequest("Vendor status", "/api/admin/vendors/$id/status", "PUT", listOf(choice("status", "pending", "approved", "rejected")), row) }) { Text("Update status") }
                        "reviews" -> TextButton(onClick = { edit = EditRequest("Review visibility", "/api/admin/reviews/$id/visibility", "PUT", listOf(flag("is_visible")), row) }) { Text("Visibility") }
                        "notifications" -> { TextButton(onClick = { vm.mutate("/api/admin/notifications/$id/read", "PUT") }) { Text("Mark read") }; if (row.display("entity_type") == "order") TextButton(onClick = { vm.openOrder(row.display("entity_id").toLongOrNull() ?: 0) }) { Text("Open order") } }
                        "messages" -> TextButton(onClick = { vm.mutate("/api/admin/messages/$id/read", "PUT") }) { Text("Mark read") }
                        "admin-users" -> TextButton(onClick = { edit = EditRequest("Account access", "/api/admin/admin-users/$id/enabled", "PUT", listOf(flag("is_active")), row) }) { Text("Enable / disable") }
                    }
                    if (module.delete) TextButton(onClick = { deletion = DeleteRequest("/api/admin/${module.endpoint}/$id", row.title(), if (module.endpoint == "categories") listOf(number("reassign_to")) else emptyList()) }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
            } }
        }
        if (module.endpoint == "inventory" && data.has("movements")) item { Text("Recent stock movements", style = MaterialTheme.typography.titleLarge); Document(JSONObject().put("movements", data.getJSONArray("movements"))) }
        if (data.optInt("pages") > 1) item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(enabled = vm.currentPage > 1 && !busy, onClick = { vm.currentPage--; vm.load() }) { Text("Previous") }
            Text("${vm.currentPage} / ${data.optInt("pages")}")
            TextButton(enabled = vm.currentPage < data.optInt("pages") && !busy, onClick = { vm.currentPage++; vm.load() }) { Text("Next") }
        } }
    }
    edit?.let { request -> Editor(request, { edit = null }) { body ->
        if (request.path == "@filters") { vm.filters = body.keys().asSequence().associateWith { body.display(it) }; vm.currentPage = 1; edit = null; vm.load() }
        else vm.mutate(request.path, request.method, request.transform(body)) { request.saved(it); edit = null }
    } }
    deletion?.let { request -> Editor(EditRequest("Delete ${request.name}?", request.path, "DELETE", request.fields), { deletion = null }, destructive = true) { body -> vm.mutate(request.path, "DELETE", body) { deletion = null } } }
    inspect?.let { row ->
        if (row.optBoolean("@invoice")) InvoiceEditor(vm) { inspect = null }
        else AlertDialog(onDismissRequest = { inspect = null; pendingImport = null }, title = { Text("Details") }, text = { Column(Modifier.verticalScroll(rememberScrollState())) { Document(row) } }, confirmButton = { TextButton(onClick = { inspect = null; pendingImport = null }) { Text("Close") } }, dismissButton = {
            if (pendingImport != null) TextButton(onClick = { val csv = pendingImport!!; vm.work { val result = vm.api.csv("/api/admin/products/import", csv); inspect = result; pendingImport = null; vm.load() } }) { Text("Confirm import") }
        })
    }
    images?.let { ProductImages(vm, it) { images = null } }
}

@Composable fun ProductImage(image: String, modifier: Modifier = Modifier) {
    val model: Any = if (image.startsWith("data:image/")) runCatching { android.util.Base64.decode(image.substringAfter(','), android.util.Base64.DEFAULT) }.getOrDefault(ByteArray(0)) else if (image.startsWith("img/")) "${AdminApi.BASE}/$image" else image
    AsyncImage(model = model, contentDescription = "Product image", modifier = modifier)
}
@Composable private fun Summary(row: JSONObject) {
    listOf("id", "status", "payment_status", "total", "price", "stock", "email", "phone", "role", "rating", "comment", "body", "created_at").forEach { key ->
        row.display(key).takeIf { it.isNotBlank() }?.let { Text("${label(key)}: ${if (key in listOf("total", "price")) "Rs. " else ""}$it", style = MaterialTheme.typography.bodyMedium, maxLines = 3) }
    }
}
@Composable fun Document(value: Any?, depth: Int = 0) {
    when (value) {
        is JSONObject -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) { value.keys().asSequence().filterNot { it in setOf("image", "image_data", "avatar", "password_hash", "session_token", "token", "@invoice") }.toList().forEach { key ->
            val item = value.opt(key)
            if (item is JSONObject || item is JSONArray) { Text(label(key), style = MaterialTheme.typography.titleMedium); Document(item, depth + 1) }
            else if (item != JSONObject.NULL && item?.toString().orEmpty().isNotBlank()) Text("${label(key)}: $item", style = MaterialTheme.typography.bodyMedium)
        } }
        is JSONArray -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { for (i in 0 until value.length()) { if (depth < 5) { Surface(shape = RoundedCornerShape(8.dp), tonalElevation = 2.dp) { Box(Modifier.padding(12.dp)) { Document(value.opt(i), depth + 1) } } } } }
        null, JSONObject.NULL -> Text("—")
        else -> Text(value.toString())
    }
}
