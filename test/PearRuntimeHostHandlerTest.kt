package to.holepunch.pear.runtime

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class PearRuntimeHostHandlerTest {
  @After
  fun resetProvider() {
    PearRuntimePackage.bundleFileProvider = null
  }

  @Test
  fun resolvesBundleOnEveryReload() {
    val handler = PearRuntimeHostHandler()
    var bundle: String? = null
    PearRuntimePackage.bundleFileProvider = { bundle }

    assertEquals("assets://index.android.bundle", handler.getJSBundleFile(false))
    bundle = "/data/pear-runtime/ota/app.bundle"
    assertEquals(bundle, handler.getJSBundleFile(false))
    bundle = "/data/other/app.bundle"
    assertEquals(bundle, handler.getJSBundleFile(false))
    bundle = null
    assertEquals("assets://index.android.bundle", handler.getJSBundleFile(false))
  }

  @Test
  fun preservesDefaultLoaderWithoutProvider() {
    assertNull(PearRuntimeHostHandler().getJSBundleFile(false))
  }

  @Test
  fun preservesDevelopmentLoader() {
    PearRuntimePackage.bundleFileProvider = { error("Development must not select an OTA bundle") }
    assertNull(PearRuntimeHostHandler().getJSBundleFile(true))
  }

  @Test
  fun preservesFatalReleaseErrors() {
    val failure = IllegalStateException("Bundle failed to load")
    val thrown = assertThrows(IllegalStateException::class.java) {
      PearRuntimeHostHandler().onReactInstanceException(false, failure)
    }
    assertSame(failure, thrown)
  }

  @Test
  fun preservesDevelopmentErrorHandling() {
    PearRuntimeHostHandler().onReactInstanceException(true, IllegalStateException())
  }
}
