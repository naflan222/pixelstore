@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package lk.pixelhouse.admin

import android.Manifest
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

@Composable fun FieldInput(field: Field, value: String, changed: (String) -> Unit) {
    if (field.kind == InputKind.Boolean) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(field.label, Modifier.weight(1f).padding(top = 12.dp)); Switch(value == "true", { changed(it.toString()) }) }
    } else if (field.choices.isNotEmpty()) {
        var expanded by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded, { expanded = it }) {
            OutlinedTextField(value.replace('_', ' '), {}, readOnly = true, label = { Text(field.label) }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) }, modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable))
            ExposedDropdownMenu(expanded, { expanded = false }) { field.choices.forEach { option -> DropdownMenuItem(text = { Text(option.replace('_', ' ')) }, onClick = { changed(option); expanded = false }) } }
        }
    } else OutlinedTextField(value, changed, label = { Text(field.label + if (field.required) " *" else "") }, modifier = Modifier.fillMaxWidth().testTag("field-${field.key}"), singleLine = field.kind != InputKind.Multiline,
        minLines = if (field.kind == InputKind.Multiline) 3 else 1,
        visualTransformation = if (field.kind == InputKind.Password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = when (field.kind) { InputKind.Number -> if (field.key == "change") KeyboardType.Text else KeyboardType.Decimal; InputKind.Password -> KeyboardType.Password; else -> when { field.key.contains("email") -> KeyboardType.Email; field.key.contains("phone") -> KeyboardType.Phone; else -> KeyboardType.Text } }))
}

@Composable fun Editor(request: EditRequest, close: () -> Unit, destructive: Boolean = false, save: (JSONObject) -> Unit) {
    val values = remember(request) { mutableStateMapOf<String, String>().apply { request.fields.forEach { f ->
        val raw = request.initial.display(f.key)
        this[f.key] = if (f.kind == InputKind.Password) "" else if (raw.isBlank()) f.default else if (f.kind == InputKind.Boolean) (raw == "true" || raw == "1").toString() else raw
    } } }
    var error by remember { mutableStateOf("") }
    var accepted by remember { mutableStateOf(false) }
    var categories by remember { mutableStateOf(listOf<JSONObject>()) }
    val context = LocalContext.current
    val vm: AdminViewModel = androidx.lifecycle.viewmodel.compose.viewModel()
    val busy by vm.loading.collectAsStateWithLifecycle()
    LaunchedEffect(request) {
        if (request.fields.any { it.key in listOf("category_id", "reassign_to") }) {
            try { categories = vm.api.request("/api/admin/categories").optJSONArray("categories")?.objects().orEmpty() }
            catch (_: Exception) { error = "Could not load categories. Close and try again." }
        }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) vm.work { values["image"] = imageData(context, uri) } }
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(request.title) }, text = {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (destructive) { Text("This permanently removes the record. Existing server rules still apply."); Row { Checkbox(accepted, { accepted = it }); Text("I want to delete this record.", Modifier.padding(top = 12.dp)) } }
            request.fields.forEach { f ->
                if (f.key == "image" && values[f.key].orEmpty().startsWith("data:")) { ProductImage(values[f.key].orEmpty(), Modifier.height(120.dp)); Text("Selected image") }
                else if (f.key in listOf("category_id", "reassign_to")) {
                    var expanded by remember { mutableStateOf(false) }
                    val selectedName = categories.firstOrNull { it.display("id") == values[f.key] }?.display("name") ?: "None"
                    ExposedDropdownMenuBox(expanded, { expanded = it }) {
                        OutlinedTextField(selectedName, {}, readOnly = true, label = { Text(if (f.key == "reassign_to") "Move products to" else "Category") }, modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable))
                        ExposedDropdownMenu(expanded, { expanded = false }) {
                            DropdownMenuItem(text = { Text("None") }, onClick = { values[f.key] = ""; expanded = false })
                            categories.forEach { category -> DropdownMenuItem(text = { Text(category.display("name")) }, onClick = { values[f.key] = category.display("id"); expanded = false }) }
                        }
                    }
                } else FieldInput(f, values[f.key].orEmpty()) { values[f.key] = it }
                if (f.key == "image") TextButton(onClick = { imagePicker.launch("image/*") }) { Text("Choose image from phone") }
            }
            if (request.fields.any { it.key in listOf("starts_at", "expires_at", "ends_at") }) Text("Dates: YYYY-MM-DD or ISO date/time; leave optional dates blank.", style = MaterialTheme.typography.bodySmall)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        }
    }, confirmButton = { TextButton(enabled = !busy && (!destructive || accepted), onClick = { try { save(formBody(request.fields, values)) } catch (e: Exception) { error = e.message.orEmpty() } }) { Text(if (destructive) "Delete permanently" else if (request.path == "@filters") "Apply filters" else "Save") } }, dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("Cancel") } })
}

suspend fun imageData(context: android.content.Context, uri: Uri): String = withContext(Dispatchers.IO) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Choose a supported image." }
    val options = BitmapFactory.Options().apply { inSampleSize = 1; while (maxOf(bounds.outWidth, bounds.outHeight) / inSampleSize > 1600) inSampleSize *= 2 }
    val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: error("Could not read that image.")
    val buffer = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 88, buffer); bitmap.recycle()
    require(buffer.size() <= 3 * 1024 * 1024) { "Image is too large. Choose a smaller image." }
    "data:image/jpeg;base64," + android.util.Base64.encodeToString(buffer.toByteArray(), android.util.Base64.NO_WRAP)
}

@Composable fun DetailScreen(vm: AdminViewModel, data: JSONObject) {
    var edit by remember { mutableStateOf<EditRequest?>(null) }
    var delete by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val order = data.optJSONObject("order")
    val id = order?.optLong("id") ?: 0
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = { vm.detail.value = null; vm.load() }) { Text("Back to list") }
        if (order != null) {
            Text("Order #$id", style = MaterialTheme.typography.headlineSmall)
            Text("Payment status: ${data.optJSONObject("payment")?.display("payment_status").orEmpty()}")
            Button(onClick = { edit = EditRequest("Update order status", "/api/admin/orders/$id/status", "PUT", listOf(choice("status", *orderStates), Field("note", kind = InputKind.Multiline)), order) }) { Text("Update order status") }
            OutlinedButton(onClick = { edit = EditRequest("Delivery and internal notes", "/api/admin/orders/$id/fulfillment", "PUT", listOf(text("carrier"), text("tracking_number"), choice("shipping_status", "pending", "preparing", "shipped", "delivered", "returned"), Field("shipping_notes", kind = InputKind.Multiline), Field("internal_notes", kind = InputKind.Multiline)), order) }) { Text("Update delivery") }
            OutlinedButton(onClick = { vm.work { shareDocument(context, vm.api.download("/api/admin/orders/$id/invoice"), "invoice-$id.pdf", "application/pdf") } }) { Text("Download / share invoice") }
            TextButton(onClick = { delete = true }) { Text("Delete order", color = MaterialTheme.colorScheme.error) }
        }
        Document(data)
        if (order == null) data.optJSONArray("orders")?.objects()?.forEach { row -> TextButton(onClick = { vm.openOrder(row.optLong("id")) }) { Text("Open order #${row.optLong("id")}") } }
    }
    edit?.let { r -> Editor(r, { edit = null }) { body -> vm.mutate(r.path, r.method, body) { edit = null } } }
    if (delete) Editor(EditRequest("Delete order #$id?", "", "DELETE", emptyList()), { delete = false }, true) { vm.mutate("/api/admin/orders/$id", "DELETE") { delete = false; vm.detail.value = null } }
}

suspend fun shareDocument(context: android.content.Context, bytes: ByteArray, name: String, mime: String) {
    val file = withContext(Dispatchers.IO) { val dir = File(context.cacheDir, "documents").apply { mkdirs(); listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86400000 }?.forEach { it.delete() } }; File(dir, name).apply { writeBytes(bytes) } }
    val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
    withContext(Dispatchers.Main) { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Save or share invoice")) }
}

@Composable fun PhoneAlerts(vm: AdminViewModel) {
    val context = LocalContext.current
    var permissionStatus by remember { mutableStateOf(NotificationManagerCompat.from(context).areNotificationsEnabled()) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed -> permissionStatus = allowed; if (allowed) vm.app.registerPhone { vm.message.value = it } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("New order alerts", style = MaterialTheme.typography.headlineSmall)
        Text("Alerts show the order number only. Open the app to view customer and payment details.")
        Text(if (BuildConfig.FIREBASE_CONFIGURED) "Firebase is included in this build." else "Firebase configuration is still needed before this build can receive alerts.")
        Text(if (permissionStatus) "Android notifications are allowed." else "Android notifications are not allowed.")
        Button(onClick = { if (Build.VERSION.SDK_INT >= 33 && !permissionStatus) request.launch(Manifest.permission.POST_NOTIFICATIONS) else vm.app.registerPhone { vm.message.value = it } }) { Text("Connect this phone") }
        OutlinedButton(enabled = BuildConfig.FIREBASE_CONFIGURED && permissionStatus, onClick = { vm.mutate("/api/mobile/devices/${vm.api.vault.deviceId()}/test", "POST") }) { Text("Send test notification") }
        TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }) { Text("Sound and notification settings") }
        TextButton(onClick = { vm.mutate("/api/mobile/devices/${vm.api.vault.deviceId()}", "DELETE") }) { Text("Disconnect this phone") }
        Text("Delivery needs internet and an active owner session. Android force-stop or battery restrictions can prevent alerts. Sign in again after your session expires.", style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable fun ProductImages(vm: AdminViewModel, productId: Long, close: () -> Unit) {
    var images by remember { mutableStateOf(listOf<JSONObject>()) }
    var delete by remember { mutableStateOf<Long?>(null) }
    val context = LocalContext.current
    val path = "/api/admin/products/$productId/images"
    fun refresh() { vm.work { images = vm.api.request(path).getJSONArray("images").objects() } }
    LaunchedEffect(productId) { refresh() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) vm.work {
        vm.api.request(path, "POST", JSONObject().put("data", imageData(context, uri)).put("file_name", "phone-photo.jpg").put("is_primary", images.isEmpty()))
        images = vm.api.request(path).getJSONArray("images").objects()
    } }
    AlertDialog(onDismissRequest = close, title = { Text("Product images") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { picker.launch("image/*") }) { Text("Upload image") }
            images.forEachIndexed { index, image ->
                val id = image.optLong("id")
                ProductImage(image.display("image_data"), Modifier.height(150.dp).fillMaxWidth())
                Text(if (image.optInt("is_primary") == 1) "Main product image" else image.display("file_name"))
                Row { TextButton(onClick = { vm.work { vm.api.request("$path/$id/primary", "PUT"); images = vm.api.request(path).getJSONArray("images").objects() } }) { Text("Make main") }; TextButton(onClick = { delete = id }) { Text("Delete") } }
                Row { listOf(-1 to "Move up", 1 to "Move down").forEach { (direction, title) -> TextButton(enabled = index + direction in images.indices, onClick = { val ordered = images.toMutableList(); java.util.Collections.swap(ordered, index, index + direction); vm.work { vm.api.request("$path/reorder", "PUT", JSONObject().put("image_ids", JSONArray(ordered.map { it.optLong("id") }))); images = vm.api.request(path).getJSONArray("images").objects() } }) { Text(title) } } }
            }
        }
    }, confirmButton = { TextButton(onClick = close) { Text("Done") } })
    delete?.let { id -> AlertDialog(onDismissRequest = { delete = null }, title = { Text("Delete this image?") }, confirmButton = { TextButton(onClick = { delete = null; vm.work { vm.api.request("$path/$id", "DELETE"); images = vm.api.request(path).getJSONArray("images").objects() } }) { Text("Delete") } }, dismissButton = { TextButton(onClick = { delete = null }) { Text("Cancel") } }) }
}

@Composable fun HomepageSections(vm: AdminViewModel, data: JSONObject) {
    var editing by remember { mutableStateOf<String?>(null) }
    val sections = data.optJSONObject("sections") ?: return
    val products = data.optJSONArray("products")?.objects().orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { sections.keys().forEach { key ->
        Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) { Text(label(key), style = MaterialTheme.typography.titleMedium); Text("${sections.optJSONArray(key)?.length() ?: 0} selected products"); TextButton(onClick = { editing = key }) { Text("Choose and order products") } } }
    } }
    editing?.let { key ->
        val selected = remember(key) { mutableStateListOf<Long>().apply { val a = sections.optJSONArray(key) ?: JSONArray(); for (i in 0 until a.length()) add(a.optLong(i)) } }
        AlertDialog(onDismissRequest = { editing = null }, title = { Text(label(key)) }, text = { Column(Modifier.verticalScroll(rememberScrollState())) {
            Text("Selected order controls the website display. Choose 1–24 active products.")
            selected.toList().forEachIndexed { index, id -> Row { Text("${index + 1}. ${products.firstOrNull { it.optLong("id") == id }?.display("name") ?: id}", Modifier.weight(1f)); TextButton(enabled = index > 0, onClick = { java.util.Collections.swap(selected, index, index - 1) }) { Text("↑") } } }
            products.filter { it.display("status") == "active" }.forEach { product -> val id = product.optLong("id"); Row { Checkbox(id in selected, { checked -> if (checked && selected.size < 24) selected.add(id) else if (!checked) selected.remove(id) }); Text(product.display("name"), Modifier.padding(top = 12.dp)) } }
        } }, confirmButton = { TextButton(enabled = selected.size in 1..24, onClick = { vm.mutate("/api/admin/homepage-sections/$key", "PUT", JSONObject().put("product_ids", JSONArray(selected.toList()))) { editing = null } }) { Text("Save selection") } }, dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } })
    }
}

@Composable fun InvoiceEditor(vm: AdminViewModel, close: () -> Unit) {
    val fields = remember { listOf(text("full_name", true), text("email", true), text("phone"), text("address"), choice("source", "phone", "whatsapp", "in_store", "other"), choice("payment_method", "cash", "bank", "credit-card", "paypal"), choice("payment_status", "pending", "paid"), choice("shipping_method", "standard", "express", "pickup", "courier"), number("shipping_fee", "0"), number("discount_amount", "0")) }
    val values = remember { mutableStateMapOf<String,String>().apply { fields.forEach { put(it.key, it.default) } } }
    val items = remember { mutableStateListOf(mutableStateMapOf("name" to "", "price" to "0", "quantity" to "1")) }
    var error by remember { mutableStateOf("") }
    var confirmed by remember { mutableStateOf(false) }
    val busy by vm.loading.collectAsStateWithLifecycle()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text("Create offline invoice") }, text = { Column(Modifier.imePadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Creates an order and emails the invoice. Inventory is not changed.")
        fields.forEach { f -> FieldInput(f, values[f.key].orEmpty()) { values[f.key] = it } }
        items.forEachIndexed { i, item -> Card { Column(Modifier.padding(10.dp)) { Text("Item ${i + 1}"); listOf(text("name", true), number("price"), number("quantity")).forEach { f -> FieldInput(f, item[f.key].orEmpty()) { item[f.key] = it } }; if (items.size > 1) TextButton(onClick = { items.remove(item) }) { Text("Remove item") } } } }
        TextButton(enabled = items.size < 40, onClick = { items.add(mutableStateMapOf("name" to "", "price" to "0", "quantity" to "1")) }) { Text("Add invoice item") }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
    } }, confirmButton = { TextButton(enabled = !busy, onClick = { try {
        formBody(fields, values).put("items", JSONArray(items.map { formBody(listOf(text("name", true), number("price"), number("quantity")), it) }))
        confirmed = true
    } catch (e: Exception) { error = e.message.orEmpty() } }) { Text("Review and create") } }, dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("Cancel") } })
    if (confirmed) AlertDialog(onDismissRequest = { confirmed = false }, title = { Text("Create and email invoice?") }, text = { Text("For ${values["full_name"]}, ${items.size} item(s), payment ${values["payment_status"]}. This will create a permanent order record.") }, confirmButton = { TextButton(enabled = !busy, onClick = { val body = formBody(fields, values).put("items", JSONArray(items.map { formBody(listOf(text("name", true), number("price"), number("quantity")), it) })); vm.mutate("/api/admin/invoices/offline", "POST", body) { result -> confirmed = false; close(); vm.pendingOrder = result.optLong("order_id") } }) { Text("Create invoice") } }, dismissButton = { TextButton(onClick = { confirmed = false }) { Text("Back") } })
}
