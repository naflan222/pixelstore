@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package lk.pixelhouse.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONArray
import org.json.JSONObject

fun invoiceLineBody(item: Map<String,String>): JSONObject {
    val quantity = item["quantity"]?.toIntOrNull()
    require(quantity != null && quantity in 1..10000) { "Enter a whole-number quantity from 1 to 10000." }
    val price = item["price"]?.toDoubleOrNull()
    require(price != null && price.isFinite() && price >= 0) { "Enter a valid price." }
    require(!item["name"].isNullOrBlank()) { "Enter a product name." }
    val serials = JSONArray()
    if (item["serial_enabled"] == "true") repeat(quantity) { i ->
        val text = item["serial_$i"].orEmpty().trim()
        require(text.length <= 128 && text.none { it.code < 32 || it.code == 127 }) { "Serial numbers must be printable text, up to 128 characters." }
        serials.put(text)
    }
    return JSONObject().put("name", item["name"]!!.trim()).put("price", price).put("quantity", quantity)
        .put("catalog_price", item["catalog_price"]?.toDoubleOrNull() ?: JSONObject.NULL)
        .put("product_id", item["product_id"]?.toLongOrNull() ?: JSONObject.NULL).put("serial_numbers", serials)
}
private fun newInvoiceLine() = mutableStateMapOf("name" to "", "price" to "0", "quantity" to "1", "serial_enabled" to "false")
private fun clearSerials(item: MutableMap<String,String>) { item.keys.filter { it.startsWith("serial_") && it.substringAfter("serial_").toIntOrNull() != null }.forEach { item.remove(it) };item["serial_page"]="0" }
private fun hasSerials(item: Map<String,String>) = item.any { (key,value) -> key.substringAfter("serial_", "").toIntOrNull() != null && value.isNotBlank() }

@Composable fun SerialFields(item: MutableMap<String,String>) {
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    val quantity = (item["quantity"]?.toIntOrNull() ?: 1).coerceIn(1,10000)
    val enabled = item["serial_enabled"] == "true"
    FieldInput(flag("serial_enabled").copy(label="Add serial numbers"), enabled.toString()) { value ->
        val action = { if(value=="false")clearSerials(item);item["serial_enabled"]=value }
        if(value=="false" && hasSerials(item))pending=action else action()
    }
    if(enabled) {
        val pages = (quantity+9)/10
        val page = (item["serial_page"]?.toIntOrNull() ?: 0).coerceIn(0,pages-1)
        for(i in page*10 until minOf(quantity,page*10+10)) FieldInput(text("serial_$i").copy(label="Serial number — unit ${i+1} (optional)"),item["serial_$i"].orEmpty()) { item["serial_$i"]=it }
        if(pages>1) Row { TextButton(enabled=page>0,onClick={item["serial_page"]=(page-1).toString()}) { Text("Previous") };Text("${page+1} / $pages");TextButton(enabled=page+1<pages,onClick={item["serial_page"]=(page+1).toString()}) { Text("Next") } }
    }
    pending?.let { action -> AlertDialog(onDismissRequest={pending=null},title={Text("Clear serial numbers?")},text={Text("This removes the serial numbers already entered for this item.")},confirmButton={TextButton(onClick={action();pending=null}){Text("Clear")}},dismissButton={TextButton(onClick={pending=null}){Text("Keep")}}) }
}
@Composable private fun InvoiceProductLine(item: MutableMap<String,String>, products: List<JSONObject>, remove: (() -> Unit)?) {
    var expanded by remember { mutableStateOf(false) }
    var productQuery by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    fun select(product: JSONObject?) {
        val action = {
            clearSerials(item);item["product_id"]=product?.display("id").orEmpty();item["name"]=product?.display("name").orEmpty();item["catalog_price"]=product?.display("price").orEmpty();item["price"]=product?.display("price") ?: "0";item["serial_enabled"]=(product?.optBoolean("serial_eligible") == true).toString()
        }
        if(hasSerials(item))pending=action else action()
    }
    Card { Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        ExposedDropdownMenuBox(expanded,{expanded=it;if(it)productQuery=""}) {
            OutlinedTextField(if(expanded)productQuery else products.firstOrNull {it.display("id")==item["product_id"]}?.display("name") ?: "Custom item / choose product",{productQuery=it;expanded=true},label={Text("Search / choose product")},modifier=Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable))
            ExposedDropdownMenu(expanded,{expanded=false}) {
                DropdownMenuItem(text={Text("Custom item")},onClick={select(null);expanded=false})
                products.filter { productQuery.isBlank() || it.display("name").contains(productQuery,true) || it.display("sku").contains(productQuery,true) }.forEach { p -> DropdownMenuItem(text={Text(p.display("name")+" — Rs. "+p.display("price"))},onClick={select(p);expanded=false}) }
            }
        }
        FieldInput(text("name",true),item["name"].orEmpty()){item["name"]=it}
        FieldInput(number("price").copy(label="Selling price (editable)"),item["price"].orEmpty()){item["price"]=it}
        FieldInput(number("quantity"),item["quantity"].orEmpty()){ value ->
            val count=value.toIntOrNull()
            val excess=count != null && item.any { (k,v)-> (k.substringAfter("serial_", "").toIntOrNull() ?: -1) >= count && v.isNotBlank() }
            val action={ item["quantity"]=value;if(count!=null)item.keys.filter{(it.substringAfter("serial_", "").toIntOrNull() ?: -1)>=count}.forEach{item.remove(it)} }
            if(excess)pending=action else action()
        }
        item["catalog_price"]?.toDoubleOrNull()?.let { Text("Original catalog unit price: " + displayMoney(it)) }
        Text("Line total: " + displayMoney((item["price"]?.toDoubleOrNull() ?: 0.0) * (item["quantity"]?.toIntOrNull() ?: 0)))
        SerialFields(item)
        if(remove!=null)TextButton(onClick=remove){Text("Remove item")}
    } }
    pending?.let { action->AlertDialog(onDismissRequest={pending=null},title={Text("Discard affected serial numbers?")},text={Text("Changing product or reducing quantity removes the affected serial numbers.")},confirmButton={TextButton(onClick={action();pending=null}){Text("Continue")}},dismissButton={TextButton(onClick={pending=null}){Text("Cancel")}}) }
}

@Composable fun InvoiceEditor(vm: AdminViewModel, close: () -> Unit) {
    val fields=remember{listOf(text("full_name",true),text("email",true),text("phone"),text("address"),choice("source","phone","whatsapp","in_store","other"),choice("payment_method","cash","bank","credit-card","paypal"),choice("payment_status","pending","paid"),choice("shipping_method","standard","express","pickup","courier"),number("shipping_fee","0"),number("discount_amount","0"))}
    val values=remember{mutableStateMapOf<String,String>().apply{fields.forEach{put(it.key,it.default)}}}
    val items=remember{mutableStateListOf(newInvoiceLine())}
    var serialsSupported by remember{mutableStateOf(false)}
    var products by remember{mutableStateOf(listOf<JSONObject>())};var error by remember{mutableStateOf("")};var confirmed by remember{mutableStateOf(false)}
    val busy by vm.loading.collectAsStateWithLifecycle()
    LaunchedEffect(Unit){try{val data=vm.api.request("/api/admin/invoices/catalog");serialsSupported=data.optBoolean("serials_supported");products=data.optJSONArray("products")?.objects().orEmpty()}catch(_:Exception){error="Product list could not load. You can still enter a custom item."}}
    fun body(): JSONObject { require(serialsSupported || items.none {hasSerials(it)}) { "Deploy the invoice server update before creating invoices with serial numbers." };return formBody(fields,values).put("items",JSONArray(items.map{invoiceLineBody(it)})) }
    AlertDialog(onDismissRequest={if(!busy)close()},title={Text("Create offline invoice")},text={Column(Modifier.imePadding().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("Select products to fill prices automatically. You may edit the invoice price. Inventory is not changed.")
        fields.forEach{f->FieldInput(f,values[f.key].orEmpty()){values[f.key]=it}}
        items.forEach{item->InvoiceProductLine(item,products,if(items.size>1)({items.remove(item);Unit}) else null)}
        TextButton(enabled=items.size<40,onClick={items.add(newInvoiceLine())}){Text("Add invoice item")}
        val subtotal=items.sumOf{(it["price"]?.toDoubleOrNull() ?: 0.0)*(it["quantity"]?.toIntOrNull() ?: 0)}
        Text("Subtotal: " + displayMoney(subtotal))
        Text("Invoice total: " + displayMoney(subtotal+(values["shipping_fee"]?.toDoubleOrNull() ?: 0.0)-(values["discount_amount"]?.toDoubleOrNull() ?: 0.0)))
        if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
    }},confirmButton={TextButton(enabled=!busy,onClick={try{body();confirmed=true}catch(e:Exception){error=e.message.orEmpty()}}){Text("Review and create")}},dismissButton={TextButton(enabled=!busy,onClick=close){Text("Cancel")}})
    if(confirmed)AlertDialog(onDismissRequest={confirmed=false},title={Text("Create and email invoice?")},text={Text("For ${values["full_name"]}, ${items.size} item(s). Entered serials will appear below their product. This creates an offline order record.")},confirmButton={TextButton(enabled=!busy,onClick={vm.mutate("/api/admin/invoices/offline","POST",body()){result->confirmed=false;close();vm.pendingOrder=result.optLong("order_id")}}){Text("Create invoice")}},dismissButton={TextButton(onClick={confirmed=false}){Text("Back")}})
}

@Composable fun SerialCopyEditor(vm: AdminViewModel, orderId: Long, close: () -> Unit) {
    val rows=remember{mutableStateListOf<MutableMap<String,String>>()};var error by remember{mutableStateOf("")};var confirmEmail by remember{mutableStateOf(false)}
    val busy by vm.loading.collectAsStateWithLifecycle();val context=LocalContext.current
    LaunchedEffect(orderId){try{vm.api.request("/api/admin/orders/$orderId/serial-invoice").optJSONArray("items")?.objects().orEmpty().forEach{p->
        val row=mutableStateMapOf("order_item_id" to p.display("id"),"name" to p.display("name"),"price" to p.display("price"),"quantity" to p.display("quantity"),"serial_enabled" to p.optBoolean("serial_eligible").toString())
        p.optJSONArray("serial_numbers")?.let{serials->for(i in 0 until serials.length())row["serial_$i"]=serials.optString(i);if(serials.length()>0)row["serial_enabled"]="true"};rows.add(row)
    }}catch(e:Exception){error=e.message.orEmpty()}}
    suspend fun save(){val items=JSONArray(rows.map{row->val body=invoiceLineBody(row);JSONObject().put("order_item_id",row["order_item_id"]!!.toLong()).put("serial_numbers",body.getJSONArray("serial_numbers"))});vm.api.request("/api/admin/orders/$orderId/serial-invoice","PUT",JSONObject().put("items",items))}
    AlertDialog(onDismissRequest={if(!busy)close()},title={Text("Serial-number copy — #$orderId")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text("Original invoice, prices, totals and stock stay unchanged. Download/email saves these serial entries.")
        rows.forEach{row->Card{Column(Modifier.padding(10.dp)){Text(row["name"].orEmpty());Text("Rs. ${row["price"]} × ${row["quantity"]}");SerialFields(row)}}}
        if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
        TextButton(enabled=!busy&&rows.isNotEmpty(),onClick={vm.work{save();vm.message.value="Serial numbers saved"}}){Text("Save serial numbers")}
        TextButton(enabled=!busy&&rows.isNotEmpty(),onClick={vm.work{save();shareDocument(context,vm.api.download("/api/admin/orders/$orderId/serial-invoice?document=1"),"invoice-$orderId-serials.pdf","application/pdf")}}){Text("Download / share serial copy")}
        TextButton(enabled=!busy&&rows.isNotEmpty(),onClick={confirmEmail=true}){Text("Email serial copy")}
    }},confirmButton={TextButton(onClick=close){Text("Close")}})
    if(confirmEmail)AlertDialog(onDismissRequest={confirmEmail=false},title={Text("Email serial-number copy?")},text={Text("Send this separate copy to the existing order's customer email address?")},confirmButton={TextButton(enabled=!busy,onClick={vm.work{save();vm.api.request("/api/admin/orders/$orderId/serial-invoice/email","POST",JSONObject());confirmEmail=false;vm.message.value="Serial-number copy emailed"}}){Text("Send")}},dismissButton={TextButton(onClick={confirmEmail=false}){Text("Cancel")}})
}
