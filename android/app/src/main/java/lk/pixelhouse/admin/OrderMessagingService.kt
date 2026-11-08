package lk.pixelhouse.admin

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.*
import org.json.JSONObject

class PixelHouseApp: Application() {
    lateinit var api: AdminApi
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    override fun onCreate() {
        super.onCreate(); api = AdminApi(SessionVault(this))
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("orders", "New PixelHouse orders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Notifications for new orders placed on pixelhouse.lk"; enableVibration(true)
            })
        if (BuildConfig.FIREBASE_CONFIGURED) FirebaseApp.initializeApp(this)
    }
    fun registerPhone(onResult: (String) -> Unit) {
        if (!BuildConfig.FIREBASE_CONFIGURED) { onResult("Firebase configuration is pending. Admin features are available; push alerts are not enabled in this build."); return }
        if (!api.signedIn.value) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> scope.launch {
            try { api.request("/api/mobile/devices/" + api.vault.deviceId(), "PUT", JSONObject().put("token", token)); onResult("Phone connected for order alerts.") }
            catch (e: Exception) { onResult(e.message ?: "Could not register this phone. Try again.") }
        }}.addOnFailureListener { onResult("Could not obtain a Firebase token. Check your connection and Google Play services.") }
    }
}
class OrderMessagingService: FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as PixelHouseApp
        // Refresh uses the saved session; the server independently verifies owner role and expiry.
        if (app.api.vault.token() != null) app.scope.launch {
            runCatching { app.api.request("/api/mobile/devices/" + app.api.vault.deviceId(), "PUT", JSONObject().put("token", token)) }
        }
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val app = application as PixelHouseApp
        if (app.api.vault.token() == null) return
        val order = message.data["order_id"]?.toLongOrNull()?.takeIf { it > 0 }
        val test = message.data["kind"] == "test"
        if (!test && order == null) return
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val event = message.data["event_id"] ?: return
        val seen = getSharedPreferences("alert_dedup", MODE_PRIVATE)
        synchronized(OrderMessagingService::class.java) {
            if (seen.contains(event)) return
            // Retain a bounded recent event list across process restarts.
            if (seen.all.size > 500) seen.edit().clear().commit()
            val intent = Intent(this, MainActivity::class.java).apply { putExtra("order_id", order ?: 0L); flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP }
            val pending = PendingIntent.getActivity(this, event.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(this, "orders").setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(if (test) "PixelHouse alerts are connected" else "New PixelHouse order #$order")
                .setContentText("Tap to open PixelHouse Admin").setContentIntent(pending).setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPriority(NotificationCompat.PRIORITY_HIGH).build()
            NotificationManagerCompat.from(this).notify(event.hashCode(), notification)
            seen.edit().putBoolean(event, true).commit()
        }
    }
}
