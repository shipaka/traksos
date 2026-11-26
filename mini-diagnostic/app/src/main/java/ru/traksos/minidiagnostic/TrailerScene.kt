package ru.traksos.minidiagnostic

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Approved single-perspective render. All eight textures use identical coordinates.
// Each lamp layer is an RGBA image, never a black mask. No scene replacement or geometry changes.
@Composable
fun TrailerScene(outputs: Set<Channel>) {
    val orange = Color(0xFFFF8B23)
    val muted = Color(0xFFB2BCC7)
    val layers = listOf(
        Channel.LEFT_SIDE to R.drawable.trailer_cinema_left_side,
        Channel.RIGHT_SIDE to R.drawable.trailer_cinema_right_side,
        Channel.LEFT to R.drawable.trailer_cinema_left,
        Channel.RIGHT to R.drawable.trailer_cinema_right,
        Channel.STOP to R.drawable.trailer_cinema_stop,
        Channel.REVERSE to R.drawable.trailer_cinema_reverse,
        Channel.FOG to R.drawable.trailer_cinema_fog,
    )
    Column(Modifier.fillMaxWidth().background(Color(0xFF11171E),RoundedCornerShape(18.dp))
        .border(1.dp,Color(0xFF344352),RoundedCornerShape(18.dp)).padding(8.dp),
        verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal=4.dp),horizontalArrangement=Arrangement.SpaceBetween) {
            Text("СВЕТОТЕХНИКА",color=muted,fontSize=11.sp,fontWeight=FontWeight.Bold)
            Text(if(outputs.isEmpty()) "Выключено" else "Активно",color=if(outputs.isEmpty()) muted else orange,fontSize=12.sp)
        }
        Box(Modifier.fillMaxWidth().aspectRatio(4f/3f).clip(RoundedCornerShape(12.dp))) {
            Image(painterResource(R.drawable.trailer_cinema_base), "Полуприцеп, вид сзади слева",Modifier.fillMaxSize(),contentScale=ContentScale.FillBounds)
            for((channel,asset) in layers) {
                key(channel) {
                    val alpha by animateFloatAsState(if(channel in outputs) 1f else 0f,
                        animationSpec=tween(if(channel==Channel.LEFT || channel==Channel.RIGHT) 65 else 130),label=channel.name)
                    Image(painterResource(asset),null,Modifier.fillMaxSize(),contentScale=ContentScale.FillBounds,alpha=alpha)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal=4.dp),horizontalArrangement=Arrangement.SpaceBetween) {
            Text("Левый борт",color=if(Channel.LEFT_SIDE in outputs) orange else muted,fontSize=11.sp)
            Text("Правый борт",color=if(Channel.RIGHT_SIDE in outputs) orange else muted,fontSize=11.sp)
        }
    }
}
